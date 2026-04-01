import React, { useState, useEffect, useRef } from "react";
import { 
  Bot, 
  Terminal, 
  Settings, 
  Play, 
  Square, 
  Plus, 
  Folder, 
  FileCode, 
  Cpu, 
  Activity,
  ChevronRight,
  Search,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Clock,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Database,
  Circle,
  Star,
  Send
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { io, Socket } from "socket.io-client";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Project, LogEntry } from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatUptime = (seconds: number) => {
  if (seconds === 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [logs, setLogs] = useState<{ [key: string]: LogEntry[] }>({});
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectType, setNewProjectType] = useState<"node" | "python">("node");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isWelcomeVisible, setIsWelcomeVisible] = useState(() => {
    return localStorage.getItem("welcome_dismissed") !== "true";
  });
  const [viewMode, setViewMode] = useState<"dashboard" | "project">(() => {
    return (localStorage.getItem("view_mode") as "dashboard" | "project") || "dashboard";
  });
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  const socketRef = useRef<Socket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("view_mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem("selected_project_id", selectedProjectId);
    }
  }, [selectedProjectId]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const fetchProjectFiles = async (id: string) => {
    const res = await fetch(`/api/projects/${id}/files`);
    const files = await res.json();
    setProjectFiles(files);
  };

  useEffect(() => {
    // Fetch initial projects
    fetch("/api/projects")
      .then(res => res.json())
      .then(data => {
        setProjects(data);
        if (data.length > 0) {
          const savedId = localStorage.getItem("selected_project_id");
          const exists = data.find((p: Project) => p.id === savedId);
          const initialId = exists ? savedId : data[0].id;
          setSelectedProjectId(initialId);
          fetchProjectFiles(initialId);
        }
      });

    // Initialize Socket.io
    socketRef.current = io();
    
    socketRef.current.on("log", (log: LogEntry) => {
      setLogs(prev => ({
        ...prev,
        [log.projectId]: [...(prev[log.projectId] || []), log].slice(-100)
      }));
    });

    socketRef.current.on("status_change", ({ projectId, status }: { projectId: string, status: 'running' | 'stopped' }) => {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status } : p));
    });
    
    socketRef.current.on("metrics", ({ projectId, metrics }: { projectId: string, metrics: any }) => {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, metrics } : p));
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (selectedProjectId && socketRef.current) {
      socketRef.current.emit("join", selectedProjectId);
      fetchProjectFiles(selectedProjectId);
    }
    // Scroll to bottom of logs
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedProjectId, logs[selectedProjectId || ""]]);

  const handleStartProject = async (id: string) => {
    const res = await fetch(`/api/projects/${id}/start`, { method: "POST" });
    const updated = await res.json();
    setProjects(prev => prev.map(p => p.id === id ? updated : p));
  };

  const handleStopProject = async (id: string) => {
    const res = await fetch(`/api/projects/${id}/stop`, { method: "POST" });
    const updated = await res.json();
    setProjects(prev => prev.map(p => p.id === id ? updated : p));
  };

  const handleCreateProject = async () => {
    if (!newProjectName) return;
    if (projects.length >= 10) {
      alert("Storage full! Please delete some other bots to create a new one.");
      return;
    }
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjectName, type: newProjectType }),
    });
    
    if (!res.ok) {
      const errorData = await res.json();
      alert(errorData.error || "Failed to create project");
      return;
    }

    const newProj = await res.json();
    setProjects(prev => [...prev, newProj]);
    setSelectedProjectId(newProj.id);
    setIsNewProjectModalOpen(false);
    setNewProjectName("");
    setViewMode("project");
  };

  const handleInstallDependencies = async (id: string) => {
    await fetch(`/api/projects/${id}/install`, { method: "POST" });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedProjectId || !e.target.files?.length) return;
    
    const formData = new FormData();
    formData.append("projectId", selectedProjectId);
    Array.from(e.target.files).forEach((file: File) => {
      formData.append("files", file);
    });

    await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    
    // Refresh file list
    fetchProjectFiles(selectedProjectId);
    
    // Add a log message locally to show upload started
    setLogs(prev => ({
      ...prev,
      [selectedProjectId]: [...(prev[selectedProjectId] || []), {
        projectId: selectedProjectId,
        message: `[SYSTEM] Uploaded ${e.target.files?.length} files.`,
        timestamp: new Date().toISOString()
      }]
    }));
  };

  const handleSetMainFile = async (fileName: string) => {
    if (!selectedProjectId) return;
    const res = await fetch(`/api/projects/${selectedProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mainFile: fileName }),
    });
    const updated = await res.json();
    setProjects(prev => prev.map(p => p.id === selectedProjectId ? updated : p));
  };

  const handleOpenEnvModal = () => {
    if (!selectedProject) return;
    const vars = Object.entries(selectedProject.env || {}).map(([key, value]) => ({ key, value }));
    setEnvVars(vars.length > 0 ? vars : [{ key: "", value: "" }]);
    setIsEnvModalOpen(true);
  };

  const handleSaveEnv = async () => {
    if (!selectedProjectId) return;
    const envObj = envVars.reduce((acc, { key, value }) => {
      if (key.trim()) acc[key.trim()] = value;
      return acc;
    }, {} as { [key: string]: string });

    const res = await fetch(`/api/projects/${selectedProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env: envObj }),
    });
    const updated = await res.json();
    setProjects(prev => prev.map(p => p.id === selectedProjectId ? updated : p));
    setIsEnvModalOpen(false);
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm("Are you sure you want to delete this project? This action cannot be undone.")) return;
    
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProjectId === id) {
      setSelectedProjectId(projects.length > 1 ? projects.find(p => p.id !== id)?.id || null : null);
      setViewMode("dashboard");
    }
  };

  const runningBots = projects.filter(p => p.status === "running").length;
  const stoppedBots = projects.filter(p => p.status === "stopped").length;
  const totalBots = projects.length;

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          x: isSidebarOpen ? 0 : -288,
          width: isSidebarOpen ? 288 : 0
        }}
        className={cn(
          "fixed lg:relative z-50 h-full border-r border-zinc-800 flex flex-col bg-[#0d0d0d] overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out",
          !isSidebarOpen && "lg:w-0 lg:border-none"
        )}
      >
        <div className="p-6 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20 shrink-0">
            <Bot className="text-white" size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-lg tracking-tight truncate">BotHost</h1>
            <p className="text-xs text-zinc-500 font-medium truncate">Management Console</p>
          </div>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-6 custom-scrollbar">
          <div>
            <div className="flex items-center justify-between px-2 mb-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Navigation</h2>
            </div>
            <div className="space-y-1">
              <button
                onClick={() => { setViewMode("dashboard"); setIsSidebarOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
                  viewMode === "dashboard" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900"
                )}
              >
                <Activity size={18} />
                <span className="text-sm font-medium">Dashboard</span>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between px-2 mb-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Projects</h2>
              <button 
                onClick={() => setIsNewProjectModalOpen(true)}
                className="p-1 hover:bg-zinc-800 rounded-md transition-colors text-zinc-400 hover:text-white"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="space-y-1">
              {projects.map(project => (
                <button
                  key={project.id}
                  onClick={() => { setSelectedProjectId(project.id); setViewMode("project"); setIsSidebarOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
                    selectedProjectId === project.id && viewMode === "project"
                      ? "bg-zinc-800 text-white shadow-sm" 
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  )}
                >
                  <div className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    project.status === "running" ? "bg-green-500 animate-pulse" : "bg-zinc-600"
                  )} />
                  <span className="flex-1 text-left text-sm font-medium truncate">{project.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold shrink-0 text-white">JL</div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate">Josh Leetabisula</p>
              <p className="text-[10px] text-zinc-500 truncate">Pro Plan</p>
            </div>
            <LogOut size={14} className="text-zinc-600 hover:text-zinc-400 cursor-pointer shrink-0" />
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Top Nav */}
        <div className="p-4 flex items-center gap-4">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 bg-zinc-900/50 border border-zinc-800 text-zinc-400 hover:text-white rounded-lg shadow-xl transition-all active:scale-95"
          >
            <Menu size={20} />
          </button>
          
          <AnimatePresence>
            {isWelcomeVisible && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 max-w-md bg-green-900/20 border border-green-900/30 px-4 py-2 rounded-xl flex items-center justify-between"
              >
                <span className="text-sm font-medium text-green-400">Welcome back!</span>
                <button onClick={() => {
                  setIsWelcomeVisible(false);
                  localStorage.setItem("welcome_dismissed", "true");
                }} className="text-green-400/50 hover:text-green-400">
                  <X size={16} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-10">
          {viewMode === "dashboard" ? (
            <div className="max-w-4xl mx-auto space-y-10">
              <div className="flex items-center justify-between">
                <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
              </div>

              <button 
                onClick={() => {
                  if (projects.length >= 10) {
                    alert("Storage full! Please delete some other bots to create a new one.");
                  } else {
                    setIsNewProjectModalOpen(true);
                  }
                }}
                className={cn(
                  "flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg active:scale-95",
                  projects.length >= 10 
                    ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700" 
                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20"
                )}
              >
                <Plus size={20} />
                {projects.length >= 10 ? "Storage Full" : "New Bot"}
              </button>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className={cn(
                  "bg-zinc-900/50 border p-6 rounded-3xl flex items-center gap-4 transition-all",
                  projects.length >= 10 ? "border-red-500/50 bg-red-500/5" : "border-zinc-800"
                )}>
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center",
                    projects.length >= 10 ? "bg-red-600/20" : "bg-blue-600/20"
                  )}>
                    <Bot className={projects.length >= 10 ? "text-red-500" : "text-blue-500"} size={24} />
                  </div>
                  <div>
                    <p className={cn("text-2xl font-bold", projects.length >= 10 ? "text-red-500" : "")}>{totalBots} / 10</p>
                    <p className="text-xs text-zinc-500 font-medium">Bots Used {projects.length >= 10 && "(Full)"}</p>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-600/20 rounded-2xl flex items-center justify-center">
                    <Play className="text-green-500" size={20} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{runningBots}</p>
                    <p className="text-xs text-zinc-500 font-medium">Running</p>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-600/20 rounded-2xl flex items-center justify-center">
                    <Circle className="text-red-500" size={20} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stoppedBots}</p>
                    <p className="text-xs text-zinc-500 font-medium">Stopped</p>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4">
                  <div className="w-12 h-12 bg-yellow-600/20 rounded-2xl flex items-center justify-center">
                    <Database className="text-yellow-500" size={24} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold font-mono">24.3 KB</p>
                    <p className="text-xs text-zinc-500 font-medium">of 2.5 GB Storage</p>
                  </div>
                </div>
              </div>

              {/* Bot List */}
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Bot size={20} className="text-zinc-400" />
                    <h2 className="text-xl font-bold tracking-tight">Your Bots</h2>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input 
                        type="text" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search bots..."
                        className="bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-blue-600 transition-all w-full sm:w-48"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase tracking-widest bg-zinc-900/50 border border-zinc-800 px-3 py-2 rounded-xl">
                      <span className="flex items-center gap-1.5"><Circle size={6} className="fill-green-500 text-green-500" /> {runningBots}</span>
                      <span className="w-px h-2 bg-zinc-800 mx-1" />
                      <span className="flex items-center gap-1.5"><Circle size={6} className="fill-zinc-600 text-zinc-600" /> {stoppedBots}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(project => (
                    <motion.div 
                      key={project.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 relative group hover:border-zinc-700 transition-all"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                            project.status === "running" ? "bg-green-600/20" : "bg-zinc-800"
                          )}>
                            <Send size={18} className={cn(
                              project.status === "running" ? "text-green-500" : "text-zinc-500"
                            )} />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold truncate">{project.name}</h3>
                            <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">{project.type} Runtime</p>
                          </div>
                        </div>
                        <div className={cn(
                          "w-2.5 h-2.5 rounded-full",
                          project.status === "running" ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse" : "bg-zinc-700"
                        )} />
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-8">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Main File</p>
                          <div className="flex items-center gap-2 text-zinc-400">
                            <FileCode size={12} />
                            <span className="text-xs font-medium truncate">{project.mainFile}</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Uptime</p>
                          <div className="flex items-center gap-2 text-zinc-400">
                            <Clock size={12} />
                            <span className="text-xs font-medium font-mono">{formatUptime(project.metrics?.uptime || 0)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {project.status === "stopped" ? (
                          <button 
                            onClick={() => handleStartProject(project.id)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600/10 hover:bg-green-600/20 text-green-500 rounded-xl font-bold text-sm transition-all border border-green-600/20"
                          >
                            <Play size={14} fill="currentColor" />
                            Start
                          </button>
                        ) : (
                          <button 
                            onClick={() => handleStopProject(project.id)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600/10 hover:bg-red-600/20 text-red-500 rounded-xl font-bold text-sm transition-all border border-red-600/20"
                          >
                            <Square size={14} fill="currentColor" />
                            Stop
                          </button>
                        )}
                        <button 
                          onClick={() => { setSelectedProjectId(project.id); setViewMode("project"); }}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-500 rounded-xl font-bold text-sm transition-all border border-blue-600/20"
                        >
                          <Terminal size={14} />
                          Console
                        </button>
                        <button 
                          onClick={() => handleDeleteProject(project.id)}
                          className="p-2.5 bg-zinc-800 hover:bg-red-600/10 text-zinc-500 hover:text-red-500 rounded-xl transition-all border border-transparent hover:border-red-600/20"
                          title="Delete Bot"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <button className="absolute top-6 right-6 text-zinc-700 hover:text-yellow-500 transition-colors opacity-0 group-hover:opacity-100">
                        <Star size={18} />
                      </button>
                    </motion.div>
                  ))}

                  {projects.length === 0 && (
                    <div className="py-20 text-center bg-zinc-900/20 border border-dashed border-zinc-800 rounded-3xl">
                      <Bot size={40} className="mx-auto text-zinc-700 mb-4" />
                      <p className="text-zinc-500">No bots created yet. Click "New Bot" to get started.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : selectedProject ? (
            <div className="max-w-5xl mx-auto h-full flex flex-col p-6 lg:p-10 gap-8">
              {/* Project Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setViewMode("dashboard")}
                    className="w-10 h-10 flex items-center justify-center bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white rounded-xl transition-all active:scale-95"
                  >
                    <ChevronRight className="rotate-180" size={20} />
                  </button>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-3xl font-bold tracking-tight">{selectedProject?.name}</h2>
                      <div className={cn(
                        "w-2.5 h-2.5 rounded-full",
                        selectedProject?.status === "running" ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse" : "bg-zinc-700"
                      )} />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                        {selectedProject?.type}
                      </span>
                      <span className="text-zinc-600 text-xs">•</span>
                      <span className="text-xs text-zinc-500 font-medium font-mono">{selectedProject?.mainFile}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg font-bold text-xs transition-all cursor-pointer">
                      <Plus size={14} />
                      Upload
                      <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                    </label>
                    <div className="w-px h-4 bg-zinc-800 mx-1" />
                    <button 
                      onClick={() => selectedProject && handleInstallDependencies(selectedProject.id)}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg font-bold text-xs transition-all"
                    >
                      <Settings size={14} />
                      Install
                    </button>
                    <div className="w-px h-4 bg-zinc-800 mx-1" />
                    <button 
                      onClick={handleOpenEnvModal}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg font-bold text-xs transition-all"
                    >
                      <Terminal size={14} />
                      Env
                    </button>
                  </div>

                  {selectedProject.status === "stopped" ? (
                    <button 
                      onClick={() => handleStartProject(selectedProject.id)}
                      className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-green-900/20 active:scale-95"
                    >
                      <Play size={16} fill="currentColor" />
                      Start Bot
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleStopProject(selectedProject.id)}
                      className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-red-900/20 active:scale-95"
                    >
                      <Square size={16} fill="currentColor" />
                      Stop Bot
                    </button>
                  )}

                  <button 
                    onClick={() => handleDeleteProject(selectedProject.id)}
                    className="p-2.5 bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-500 rounded-xl transition-all hover:border-red-500/30 active:scale-95"
                    title="Delete Project"
                  >
                    <Square size={18} />
                  </button>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: "Status", value: selectedProject?.status, icon: Activity, color: selectedProject?.status === "running" ? "text-green-500" : "text-zinc-500" },
                  { label: "Uptime", value: formatUptime(selectedProject?.metrics?.uptime || 0), icon: Clock, color: "text-zinc-400" },
                  { label: "Memory Usage", value: `${selectedProject?.metrics?.memory || 0} MB`, icon: Cpu, color: "text-zinc-400" },
                  { label: "CPU Load", value: `${selectedProject?.metrics?.cpu || 0}%`, icon: Activity, color: "text-zinc-400" },
                ].map((stat, i) => (
                  <div key={i} className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-3xl group hover:border-zinc-700 transition-all">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 group-hover:text-zinc-400 transition-colors">{stat.label}</span>
                      <stat.icon size={14} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                    </div>
                    <p className={cn("text-xl font-bold tracking-tight capitalize font-mono", stat.color)}>{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-hidden">
                {/* File Manager */}
                <div className="lg:col-span-1 bg-zinc-900/30 border border-zinc-800 rounded-3xl flex flex-col overflow-hidden">
                  <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                    <div className="flex items-center gap-2">
                      <Folder size={16} className="text-zinc-500" />
                      <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Project Files</span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-1">
                    {projectFiles.length > 0 ? (
                      projectFiles.map(file => (
                        <button
                          key={file}
                          onClick={() => handleSetMainFile(file)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all group",
                            selectedProject?.mainFile === file 
                              ? "bg-blue-600/10 text-blue-500 border border-blue-600/20" 
                              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent"
                          )}
                        >
                          {file.endsWith('.py') ? <Cpu size={14} /> : <FileCode size={14} />}
                          <span className="flex-1 text-left truncate font-medium">{file}</span>
                          {selectedProject?.mainFile === file && <CheckCircle2 size={14} className="text-blue-500" />}
                        </button>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-2 p-4">
                        <AlertCircle size={24} strokeWidth={1} />
                        <p className="text-xs text-center">No files uploaded yet.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Console */}
                <div className="lg:col-span-2 flex flex-col bg-black rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl">
                  <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal size={14} className="text-zinc-500" />
                      <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Live Console</span>
                    </div>
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                      <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                      <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                    </div>
                  </div>
                  <div className="flex-1 p-6 font-mono text-[11px] overflow-y-auto space-y-2 custom-scrollbar bg-[#050505]">
                    {logs[selectedProject.id]?.length ? (
                      logs[selectedProject.id].map((log, i) => (
                        <div key={i} className="flex gap-4 group">
                          <span className="text-zinc-800 select-none shrink-0">{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}</span>
                          <span className={cn(
                            "flex-1 break-all",
                            log.message.includes("[SUCCESS]") ? "text-green-400" :
                            log.message.includes("[DEBUG]") ? "text-zinc-600 italic" :
                            log.message.includes("[ERROR]") ? "text-red-400" :
                            log.message.includes("[INSTALL]") ? "text-blue-400" : "text-zinc-400"
                          )}>
                            {log.message}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-700 gap-3">
                        <Terminal size={40} strokeWidth={1} className="opacity-20" />
                        <p className="text-sm font-sans">Waiting for application logs...</p>
                      </div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-4">
              <Bot size={48} className="text-zinc-800 animate-pulse" />
              <p className="text-sm font-medium">Loading project details...</p>
              <button 
                onClick={() => setViewMode("dashboard")}
                className="text-xs text-blue-500 hover:underline"
              >
                Back to Dashboard
              </button>
            </div>
          )}
        </div>
      </main>

      {/* New Project Modal */}
      <AnimatePresence>
        {isNewProjectModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNewProjectModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[#0d0d0d] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-800">
                <h3 className="text-xl font-bold tracking-tight">Create New Project</h3>
                <p className="text-sm text-zinc-500 mt-1">Set up a new environment for your bot.</p>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Project Name</label>
                  <input 
                    type="text" 
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g. My Awesome Bot"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Runtime Environment</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setNewProjectType("node")}
                      className={cn(
                        "flex items-center justify-center gap-3 p-4 rounded-xl border transition-all",
                        newProjectType === "node" ? "bg-orange-600/10 border-orange-600 text-orange-500" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      )}
                    >
                      <FileCode size={20} />
                      <span className="font-bold text-sm">Node.js</span>
                    </button>
                    <button 
                      onClick={() => setNewProjectType("python")}
                      className={cn(
                        "flex items-center justify-center gap-3 p-4 rounded-xl border transition-all",
                        newProjectType === "python" ? "bg-blue-600/10 border-blue-600 text-blue-500" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      )}
                    >
                      <Cpu size={20} />
                      <span className="font-bold text-sm">Python</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="p-6 bg-zinc-900/50 border-t border-zinc-800 flex gap-3">
                <button 
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold text-sm transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCreateProject}
                  disabled={!newProjectName}
                  className="flex-1 px-4 py-3 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:hover:bg-orange-600 rounded-xl font-bold text-sm transition-all shadow-lg shadow-orange-900/20"
                >
                  Create Project
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Environment Variables Modal */}
      <AnimatePresence>
        {isEnvModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEnvModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-[#0d0d0d] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold tracking-tight">Environment Variables</h3>
                  <p className="text-sm text-zinc-500 mt-1">Configure secrets and config for your bot.</p>
                </div>
                <button 
                  onClick={() => setEnvVars([...envVars, { key: "", value: "" }])}
                  className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-all"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="p-6 max-h-[400px] overflow-y-auto space-y-4 custom-scrollbar">
                {envVars.map((v, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="flex-1 space-y-1">
                      <input 
                        type="text" 
                        value={v.key}
                        onChange={(e) => {
                          const newVars = [...envVars];
                          newVars[i].key = e.target.value;
                          setEnvVars(newVars);
                        }}
                        placeholder="VARIABLE_NAME"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono focus:outline-none focus:border-orange-600 transition-colors"
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <input 
                        type="text" 
                        value={v.value}
                        onChange={(e) => {
                          const newVars = [...envVars];
                          newVars[i].value = e.target.value;
                          setEnvVars(newVars);
                        }}
                        placeholder="value"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono focus:outline-none focus:border-orange-600 transition-colors"
                      />
                    </div>
                    <button 
                      onClick={() => setEnvVars(envVars.filter((_, idx) => idx !== i))}
                      className="p-2 text-zinc-600 hover:text-red-500 transition-colors mt-1"
                    >
                      <Square size={14} />
                    </button>
                  </div>
                ))}
                {envVars.length === 0 && (
                  <div className="text-center py-8 text-zinc-600">
                    <p className="text-sm">No environment variables set.</p>
                  </div>
                )}
              </div>
              <div className="p-6 bg-zinc-900/50 border-t border-zinc-800 flex gap-3">
                <button 
                  onClick={() => setIsEnvModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold text-sm transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveEnv}
                  className="flex-1 px-4 py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-bold text-sm transition-all shadow-lg shadow-orange-900/20"
                >
                  Save Variables
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}
