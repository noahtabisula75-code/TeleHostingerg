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
  PanelLeftOpen
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { io, Socket } from "socket.io-client";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Project, LogEntry } from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [logs, setLogs] = useState<{ [key: string]: LogEntry[] }>({});
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectType, setNewProjectType] = useState<"node" | "python">("node");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  
  const socketRef = useRef<Socket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

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
          setSelectedProjectId(data[0].id);
          fetchProjectFiles(data[0].id);
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
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjectName, type: newProjectType }),
    });
    const newProj = await res.json();
    setProjects(prev => [...prev, newProj]);
    setSelectedProjectId(newProj.id);
    setIsNewProjectModalOpen(false);
    setNewProjectName("");
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

  const formatUptime = (seconds: number) => {
    if (!seconds) return "0s";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-orange-500/30 overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 288, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 100 }}
            className="border-r border-zinc-800 flex flex-col bg-[#0d0d0d] overflow-hidden whitespace-nowrap"
          >
            <div className="p-6 flex items-center gap-3 border-b border-zinc-800">
              <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-900/20 shrink-0">
                <Bot className="text-white" size={24} />
              </div>
              <div className="min-w-0">
                <h1 className="font-bold text-lg tracking-tight truncate">TeleHostinger</h1>
                <p className="text-xs text-zinc-500 font-medium truncate">Bot Management</p>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-6 custom-scrollbar">
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
                      onClick={() => setSelectedProjectId(project.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
                        selectedProjectId === project.id 
                          ? "bg-zinc-800 text-white shadow-sm" 
                          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                      )}
                    >
                      <div className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        project.status === "running" ? "bg-green-500 animate-pulse" : "bg-zinc-600"
                      )} />
                      <span className="flex-1 text-left text-sm font-medium truncate">{project.name}</span>
                      <ChevronRight size={14} className={cn(
                        "opacity-0 transition-opacity shrink-0",
                        selectedProjectId === project.id && "opacity-100"
                      )} />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 px-2 mb-3">System</h2>
                <div className="space-y-1">
                  <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-all">
                    <Activity size={18} className="shrink-0" />
                    <span className="text-sm font-medium">Metrics</span>
                  </button>
                  <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-all">
                    <Settings size={18} className="shrink-0" />
                    <span className="text-sm font-medium">Settings</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-zinc-800">
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50">
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold shrink-0">JD</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">Josh Doe</p>
                  <p className="text-[10px] text-zinc-500 truncate">Free Plan</p>
                </div>
                <LogOut size={14} className="text-zinc-600 hover:text-zinc-400 cursor-pointer shrink-0" />
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {!isSidebarOpen && (
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-6 left-6 z-40 p-2 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white rounded-lg shadow-xl transition-all active:scale-95"
          >
            <PanelLeftOpen size={20} />
          </button>
        )}
        {selectedProject ? (
          <>
            {/* Header */}
            <header className="h-20 border-b border-zinc-800 flex items-center justify-between px-8 bg-[#0d0d0d]/50 backdrop-blur-md">
              <div className="flex items-center gap-4">
                {isSidebarOpen && (
                  <button 
                    onClick={() => setIsSidebarOpen(false)}
                    className="p-2 hover:bg-zinc-800 text-zinc-500 hover:text-white rounded-lg transition-colors mr-2"
                  >
                    <PanelLeftClose size={20} />
                  </button>
                )}
                <div className="p-2 bg-zinc-800 rounded-lg">
                  {selectedProject.type === "node" ? <FileCode className="text-yellow-500" /> : <Cpu className="text-blue-500" />}
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">{selectedProject.name}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                      {selectedProject.type}
                    </span>
                    <span className="text-zinc-600 text-xs">•</span>
                    <span className="text-xs text-zinc-500 font-medium">{selectedProject.mainFile}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-bold text-sm transition-all cursor-pointer border border-zinc-700">
                  <Plus size={16} />
                  Upload Files
                  <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                </label>
                
                <button 
                  onClick={() => handleInstallDependencies(selectedProject.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-bold text-sm transition-all border border-zinc-700"
                >
                  <Settings size={16} />
                  Install Deps
                </button>

                <button 
                  onClick={handleOpenEnvModal}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-bold text-sm transition-all border border-zinc-700"
                >
                  <Terminal size={16} />
                  Env Vars
                </button>

                {selectedProject.status === "stopped" ? (
                  <button 
                    onClick={() => handleStartProject(selectedProject.id)}
                    className="flex items-center gap-2 px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold text-sm transition-all shadow-lg shadow-orange-900/20 active:scale-95"
                  >
                    <Play size={16} fill="currentColor" />
                    Deploy Bot
                  </button>
                ) : (
                  <button 
                    onClick={() => handleStopProject(selectedProject.id)}
                    className="flex items-center gap-2 px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-bold text-sm transition-all active:scale-95 border border-zinc-700"
                  >
                    <Square size={16} fill="currentColor" />
                    Stop Process
                  </button>
                )}
              </div>
            </header>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col p-8 gap-8">
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-6">
                {[
                  { label: "Status", value: selectedProject.status, icon: Activity, color: selectedProject.status === "running" ? "text-green-500" : "text-zinc-500" },
                  { label: "Uptime", value: formatUptime(selectedProject.metrics?.uptime || 0), icon: Clock, color: "text-zinc-400" },
                  { label: "Memory", value: `${selectedProject.metrics?.memory || 0}MB`, icon: Cpu, color: "text-zinc-400" },
                  { label: "CPU Usage", value: `${selectedProject.metrics?.cpu || 0}%`, icon: Activity, color: "text-zinc-400" },
                ].map((stat, i) => (
                  <div key={i} className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{stat.label}</span>
                      <stat.icon size={14} className="text-zinc-600" />
                    </div>
                    <p className={cn("text-2xl font-bold tracking-tight capitalize", stat.color)}>{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-8 flex-1 overflow-hidden">
                {/* File Manager */}
                <div className="col-span-1 bg-zinc-900/30 border border-zinc-800 rounded-2xl flex flex-col overflow-hidden">
                  <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Folder size={16} className="text-zinc-500" />
                      <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Project Files</span>
                    </div>
                    <label className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors text-zinc-400 hover:text-white cursor-pointer">
                      <Plus size={16} />
                      <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                    </label>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
                    {projectFiles.length > 0 ? (
                      projectFiles.map(file => (
                        <div 
                          key={file} 
                          className={cn(
                            "flex items-center justify-between px-3 py-2 rounded-lg text-sm group transition-all",
                            selectedProject.mainFile === file ? "bg-orange-600/10 text-orange-500" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {file.endsWith('.js') || file.endsWith('.ts') ? <FileCode size={14} className="text-yellow-500 shrink-0" /> : 
                             file.endsWith('.py') ? <Cpu size={14} className="text-blue-500 shrink-0" /> :
                             file === 'requirements.txt' || file === 'package.json' ? <Settings size={14} className="text-zinc-500 shrink-0" /> :
                             <FileCode size={14} className="text-zinc-600 shrink-0" />
                            }
                            <span className="truncate font-medium">{file}</span>
                          </div>
                          {selectedProject.mainFile !== file && (file.endsWith('.js') || file.endsWith('.py')) && (
                            <button 
                              onClick={() => handleSetMainFile(file)}
                              className="opacity-0 group-hover:opacity-100 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-white transition-opacity"
                            >
                              Set Main
                            </button>
                          )}
                          {selectedProject.mainFile === file && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-orange-500">Main</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-2 p-4">
                        <AlertCircle size={24} strokeWidth={1} />
                        <p className="text-xs text-center">No files uploaded yet. Upload your .py, .js, or requirements.txt files.</p>
                      </div>
                    )}
                  </div>
                  <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                      Supported: .js, .py, .txt, .json, .env, and more.
                    </p>
                  </div>
                </div>

                {/* Console */}
                <div className="col-span-2 flex flex-col bg-black rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl">
                  <div className="px-5 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
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
                  <div className="flex-1 p-5 font-mono text-xs overflow-y-auto space-y-1.5 custom-scrollbar">
                    {logs[selectedProject.id]?.length ? (
                      logs[selectedProject.id].map((log, i) => (
                        <div key={i} className="flex gap-4 group">
                          <span className="text-zinc-700 select-none">{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}</span>
                          <span className={cn(
                            "flex-1",
                            log.message.includes("[SUCCESS]") ? "text-green-400" :
                            log.message.includes("[DEBUG]") ? "text-zinc-500 italic" :
                            log.message.includes("[ERROR]") ? "text-red-400" :
                            log.message.includes("[INSTALL]") ? "text-blue-400" : "text-zinc-300"
                          )}>
                            {log.message}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-3">
                        <Terminal size={32} strokeWidth={1} />
                        <p className="text-sm">Waiting for application logs...</p>
                      </div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center mb-6 border border-zinc-800">
              <Folder size={40} className="text-zinc-700" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-2">No Project Selected</h2>
            <p className="text-zinc-500 max-w-md mb-8">
              Select an existing project from the sidebar or create a new one to start hosting your Telegram bots.
            </p>
            <button 
              onClick={() => setIsNewProjectModalOpen(true)}
              className="flex items-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-orange-900/20"
            >
              <Plus size={20} />
              Create New Project
            </button>
          </div>
        )}
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
