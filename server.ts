import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import fs from "fs";
import { spawn, ChildProcess } from "child_process";
import https from "https";
import pidusage from "pidusage";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const PORT = 3000;
const PROJECTS_DIR = path.join(process.cwd(), "projects");

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectId = req.body.projectId || "default";
    const projectDir = path.join(PROJECTS_DIR, projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    cb(null, projectDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

app.use(express.json());

// In-memory project state (should be persisted in a real DB)
let projects: any[] = [];

// Track active processes
const activeProcesses: { [key: string]: ChildProcess } = {};

// Supabase client (lazy initialization)
let supabase: any = null;
const getSupabase = () => {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (url && key) {
      supabase = createClient(url, key);
    }
  }
  return supabase;
};

// Sync projects with Supabase
const syncProjects = async () => {
  const client = getSupabase();
  if (!client) return;
  
  const { data, error } = await client.from("projects").select("*");
  if (!error && data) {
    // Remove projects that are no longer in Supabase
    const supabaseIds = data.map(p => p.id);
    projects = projects.filter(p => {
      if (!supabaseIds.includes(p.id)) {
        // Stop process if it was running
        if (activeProcesses[p.id]) {
          activeProcesses[p.id].kill();
          delete activeProcesses[p.id];
        }
        return false;
      }
      return true;
    });

    // Merge with in-memory projects
    data.forEach(p => {
      const existing = projects.find(ep => ep.id === p.id);
      if (!existing) {
        projects.push({ 
          ...p, 
          env: p.env || {},
          status: p.status || "stopped", // Respect status from DB on first load
          metrics: { cpu: 0, memory: 0, uptime: 0, requests: 0 }, 
          startTime: p.status === "running" ? Date.now() : null 
        });
      } else {
        // Update metadata but keep runtime status
        Object.assign(existing, { 
          name: p.name, 
          type: p.type, 
          mainFile: p.mainFile, 
          env: p.env || {} 
        });
      }
    });
  }
};

const saveProject = async (project: any) => {
  const client = getSupabase();
  if (!client) return;
  
  const { id, name, type, mainFile, createdAt, status, env } = project;
  await client.from("projects").upsert({ id, name, type, mainFile, createdAt, status, env });
};

const saveFileToSupabase = async (projectId: string, fileName: string, content: string) => {
  const client = getSupabase();
  if (!client) return;
  await client.from("project_files").upsert({ 
    project_id: projectId, 
    file_name: fileName, 
    content,
    updated_at: new Date().toISOString()
  }, { onConflict: 'project_id,file_name' });
};

const hydrateProjectFiles = async (projectId: string) => {
  const client = getSupabase();
  if (!client) return;

  const projectDir = path.join(PROJECTS_DIR, projectId);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const { data, error } = await client
    .from("project_files")
    .select("file_name, content")
    .eq("project_id", projectId);

  if (!error && data) {
    for (const file of data) {
      const filePath = path.join(projectDir, file.file_name);
      fs.writeFileSync(filePath, file.content);
    }
    return true;
  }
  return false;
};

const startProject = async (id: string) => {
  const project = projects.find((p) => p.id === id);
  if (!project || activeProcesses[id]) return;

  // Hydrate files from Supabase before starting (crucial for Render free tier)
  await hydrateProjectFiles(id);

  const projectDir = path.join(PROJECTS_DIR, id);
  
  const startProcess = (cmd: string, args: string[]) => {
    const child = spawn(cmd, args, {
      cwd: projectDir,
      env: { ...process.env, ...project.env, FORCE_COLOR: "1" },
    });

    child.on("error", (err: any) => {
      if (cmd === "python3") {
        startProcess("python", args);
      } else {
        io.to(id).emit("log", {
          projectId: id,
          message: `[SYSTEM ERROR] Failed to start process: ${err.message}`,
          timestamp: new Date().toISOString(),
        });
        project.status = "stopped";
        saveProject(project);
        delete activeProcesses[id];
        io.to(id).emit("status_change", { projectId: id, status: "stopped" });
      }
    });

    activeProcesses[id] = child;
    project.status = "running";
    project.startTime = Date.now();
    saveProject(project);
    io.to(id).emit("status_change", { projectId: id, status: "running" });

    child.stdout?.on("data", (data) => {
      io.to(id).emit("log", { projectId: id, message: data.toString(), timestamp: new Date().toISOString() });
    });

    child.stderr?.on("data", (data) => {
      io.to(id).emit("log", { projectId: id, message: `[ERROR] ${data.toString()}`, timestamp: new Date().toISOString() });
    });

    child.on("close", (code) => {
      project.status = "stopped";
      project.startTime = null;
      project.metrics = { cpu: 0, memory: 0, uptime: 0, requests: 0 };
      saveProject(project);
      delete activeProcesses[id];
      io.to(id).emit("status_change", { projectId: id, status: "stopped" });
    });
  };

  const mainFile = project.mainFile || (project.type === "python" ? "main.py" : "index.js");
  const cmd = project.type === "node" ? "node" : "python3";
  const args = [mainFile];
  startProcess(cmd, args);
};

// API Routes
app.get("/api/projects", async (req, res) => {
  await syncProjects();
  res.json(projects);
});

app.post("/api/projects", async (req, res) => {
  if (projects.length >= 10) {
    return res.status(400).json({ error: "Storage full! Please delete some other bots to create a new one." });
  }
  const id = Math.random().toString(36).substr(2, 9);
  const newProject = {
    id,
    name: req.body.name || "Untitled Project",
    status: "stopped",
    type: req.body.type || "node",
    mainFile: req.body.mainFile || (req.body.type === "python" ? "main.py" : "index.js"),
    env: {},
    createdAt: new Date().toISOString(),
    metrics: { cpu: 0, memory: 0, uptime: 0, requests: 0 },
    startTime: null,
  };
  
  const projectDir = path.join(PROJECTS_DIR, id);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  projects.push(newProject);
  await saveProject(newProject);
  res.json(newProject);
});

app.post("/api/upload", upload.array("files"), async (req, res) => {
  const { projectId } = req.body;
  const files = req.files as Express.Multer.File[];

  if (projectId && files) {
    for (const file of files) {
      const content = fs.readFileSync(file.path, "utf-8");
      await saveFileToSupabase(projectId, file.originalname, content);
    }
  }

  res.json({ message: "Files uploaded and persisted successfully" });
});

app.post("/api/projects/:id/start", async (req, res) => {
  const { id } = req.params;
  const project = projects.find((p) => p.id === id);
  
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (activeProcesses[id]) return res.status(400).json({ error: "Project already running" });

  try {
    await startProject(id);
    res.json(project);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/projects/:id/stop", async (req, res) => {
  const { id } = req.params;
  const child = activeProcesses[id];
  
  const project = projects.find(p => p.id === id);
  if (child) {
    child.kill();
    delete activeProcesses[id];
    if (project) {
      project.status = "stopped";
      await saveProject(project);
    }
    res.json({ message: "Project stopped" });
  } else if (project && project.status === "running") {
    // Handle case where status is running but process is gone
    project.status = "stopped";
    await saveProject(project);
    res.json({ message: "Project status reset to stopped" });
  } else {
    res.status(404).json({ error: "No active process found" });
  }
});

app.get("/api/projects/:id/files", async (req, res) => {
  const { id } = req.params;
  const projectDir = path.join(PROJECTS_DIR, id);
  
  // If directory doesn't exist, try to hydrate from Supabase
  if (!fs.existsSync(projectDir)) {
    await hydrateProjectFiles(id);
  }

  if (!fs.existsSync(projectDir)) {
    return res.json([]);
  }

  try {
    const files = fs.readdirSync(projectDir);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: "Could not list files" });
  }
});

app.patch("/api/projects/:id", async (req, res) => {
  const { id } = req.params;
  const project = projects.find(p => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  if (req.body.mainFile) project.mainFile = req.body.mainFile;
  if (req.body.name) project.name = req.body.name;
  if (req.body.env) project.env = req.body.env;
  
  await saveProject(project);
  res.json(project);
});

app.delete("/api/projects/:id", async (req, res) => {
  const { id } = req.params;
  const projectIndex = projects.findIndex(p => p.id === id);
  
  if (projectIndex === -1) return res.status(404).json({ error: "Project not found" });

  // Stop process if running
  if (activeProcesses[id]) {
    activeProcesses[id].kill();
    delete activeProcesses[id];
  }

  // Delete from Supabase if exists
  const client = getSupabase();
  if (client) {
    await client.from("project_files").delete().eq("project_id", id);
    await client.from("projects").delete().eq("id", id);
  }

  // Delete local directory
  const projectDir = path.join(PROJECTS_DIR, id);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  projects.splice(projectIndex, 1);
  res.json({ message: "Project deleted successfully" });
});

app.post("/api/projects/:id/install", (req, res) => {
  const { id } = req.params;
  const project = projects.find(p => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const projectDir = path.join(PROJECTS_DIR, id);
  
  // Check if requirements.txt exists for python projects
  if (project.type === "python") {
    const reqPath = path.join(projectDir, "requirements.txt");
    if (!fs.existsSync(reqPath)) {
      io.to(id).emit("log", {
        projectId: id,
        message: `[INSTALL ERROR] requirements.txt not found in project folder. Please upload it first.`,
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({ error: "requirements.txt not found" });
    }
  }

  // Log files for debugging
  try {
    const files = fs.readdirSync(projectDir);
    io.to(id).emit("log", {
      projectId: id,
      message: `[SYSTEM] Project files: ${files.join(", ")}`,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {}

  // Attempt to use python3 -m pip (most reliable), fallback to python -m pip, then pip3/pip
  const runInstall = (cmd: string, args: string[]) => {
    io.to(id).emit("log", {
      projectId: id,
      message: `[SYSTEM] Running: ${cmd} ${args.join(" ")}`,
      timestamp: new Date().toISOString(),
    });

    const child = spawn(cmd, args, { cwd: projectDir });
    let stderr = "";

    child.on("error", (err: any) => {
      if (cmd === "python3" && args[0] === "-m") {
        runInstall("python", args);
      } else if (cmd === "python" && args[0] === "-m") {
        runInstall("pip3", ["install", "--break-system-packages", "-r", "requirements.txt"]);
      } else if (cmd === "pip3") {
        runInstall("pip", ["install", "--break-system-packages", "-r", "requirements.txt"]);
      } else {
        io.to(id).emit("log", {
          projectId: id,
          message: `[INSTALL ERROR] Could not find a working pip command. (Error: ${err.message})`,
          timestamp: new Date().toISOString(),
        });
      }
    });

    child.stdout?.on("data", (data) => {
      io.to(id).emit("log", {
        projectId: id,
        message: `[INSTALL] ${data.toString()}`,
        timestamp: new Date().toISOString(),
      });
    });

    child.stderr?.on("data", (data) => {
      const msg = data.toString();
      stderr += msg;
      io.to(id).emit("log", {
        projectId: id,
        message: `[INSTALL ERROR] ${msg}`,
        timestamp: new Date().toISOString(),
      });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        let handled = false;
        // If "No module named pip" error occurred, try fallback
        if (stderr.includes("No module named pip")) {
          if (cmd === "python3" && args[0] === "-m") {
            // Try to install pip using ensurepip
            io.to(id).emit("log", {
              projectId: id,
              message: `[SYSTEM] Pip missing. Attempting to install pip using ensurepip...`,
              timestamp: new Date().toISOString(),
            });
            const ensurePip = spawn("python3", ["-m", "ensurepip", "--default-pip"], { cwd: projectDir });
            ensurePip.on("close", (epCode) => {
              if (epCode === 0) {
                io.to(id).emit("log", {
                  projectId: id,
                  message: `[SYSTEM] Pip installed successfully via ensurepip. Retrying installation...`,
                  timestamp: new Date().toISOString(),
                });
                runInstall("python3", ["-m", "pip", "install", "--break-system-packages", "-r", "requirements.txt"]);
              } else {
                // Try get-pip.py
                io.to(id).emit("log", {
                  projectId: id,
                  message: `[SYSTEM] ensurepip failed. Attempting to download and run get-pip.py...`,
                  timestamp: new Date().toISOString(),
                });
                const getPipPath = path.join(projectDir, "get-pip.py");
                const file = fs.createWriteStream(getPipPath);
                https.get("https://bootstrap.pypa.io/get-pip.py", (response) => {
                  response.pipe(file);
                  file.on("finish", () => {
                    file.close();
                    const installPip = spawn("python3", ["get-pip.py", "--user"], { cwd: projectDir });
                    installPip.on("close", (ipCode) => {
                      if (ipCode === 0) {
                        io.to(id).emit("log", {
                          projectId: id,
                          message: `[SYSTEM] Pip installed successfully via get-pip.py. Retrying installation...`,
                          timestamp: new Date().toISOString(),
                        });
                        runInstall("python3", ["-m", "pip", "install", "--break-system-packages", "--user", "-r", "requirements.txt"]);
                      } else {
                        runInstall("pip3", ["install", "--break-system-packages", "-r", "requirements.txt"]);
                      }
                    });
                  });
                }).on("error", (err) => {
                  fs.unlink(getPipPath, () => {});
                  runInstall("pip3", ["install", "--break-system-packages", "-r", "requirements.txt"]);
                });
              }
            });
            handled = true;
          } else if (cmd === "python" && args[0] === "-m") {
            runInstall("pip", ["install", "--break-system-packages", "-r", "requirements.txt"]);
            handled = true;
          }
        }
        
        if (!handled) {
          io.to(id).emit("log", {
            projectId: id,
            message: `[INSTALL ERROR] Installation failed with exit code ${code}.`,
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        io.to(id).emit("log", {
          projectId: id,
          message: `[SUCCESS] Installation completed successfully.`,
          timestamp: new Date().toISOString(),
        });
      }
    });
  };

  const command = project.type === "node" ? "npm" : "python3";
  const args = project.type === "node" ? ["install"] : ["-m", "pip", "install", "--break-system-packages", "-r", "requirements.txt"];

  runInstall(command, args);

  res.json({ message: "Installation started" });
});

// Socket.io connection
io.on("connection", (socket) => {
  socket.on("join", (projectId) => {
    socket.join(projectId);
  });
});

// Vite integration
async function startServer() {
  // Initial sync and restart running projects
  await syncProjects();
  for (const p of projects) {
    if (p.status === "running") {
      console.log(`[BOOT] Restarting project: ${p.name}`);
      await startProject(p.id);
    }
  }

  // Metric collection loop
  setInterval(async () => {
    for (const id in activeProcesses) {
      const child = activeProcesses[id];
      const project = projects.find(p => p.id === id);
      if (child && child.pid && project) {
        try {
          const stats = await pidusage(child.pid);
          project.metrics = {
            cpu: Math.round(stats.cpu),
            memory: Math.round(stats.memory / 1024 / 1024), // MB
            uptime: Math.round((Date.now() - project.startTime) / 1000),
            requests: project.metrics.requests || 0 // Placeholder for real request tracking
          };
          io.to(id).emit("metrics", { projectId: id, metrics: project.metrics });
        } catch (err) {
          // Process might have exited
          pidusage.clear();
        }
      }
    }
  }, 3000);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
