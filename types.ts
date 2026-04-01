export interface Project {
  id: string;
  name: string;
  status: 'running' | 'stopped';
  type: 'node' | 'python';
  mainFile: string;
  env?: { [key: string]: string };
  metrics?: {
    cpu: number;
    memory: number;
    uptime: number;
    requests: number;
  };
}

export interface LogEntry {
  projectId: string;
  message: string;
  timestamp: string;
}
