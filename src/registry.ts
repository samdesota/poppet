import fs from "node:fs";
import path from "node:path";
import {
  getConfigDir,
  getLogsDir,
  getRegistryPath,
  getLockPath,
} from "./config.js";

export interface RegistryEntry {
  id: number;
  command: string;
  args: string[];
  cwd: string;
  pid: number;
  startedAt: string;
  status: "running" | "exited" | "stopped";
}

export interface Registry {
  nextId: number;
  entries: RegistryEntry[];
}

function emptyRegistry(): Registry {
  return { nextId: 1, entries: [] };
}

export async function readRegistry(): Promise<Registry> {
  const registryPath = getRegistryPath();
  try {
    const data = fs.readFileSync(registryPath, "utf-8");
    return JSON.parse(data) as Registry;
  } catch {
    return emptyRegistry();
  }
}

function writeRegistry(registry: Registry): void {
  const registryPath = getRegistryPath();
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.mkdirSync(getLogsDir(), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
}

async function acquireLock(): Promise<void> {
  const lockPath = getLockPath();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const maxRetries = 50;
  const retryDelay = 50;
  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, retryDelay));
    }
  }
  // Stale lock — force acquire
  fs.writeFileSync(lockPath, String(process.pid));
}

function releaseLock(): void {
  try {
    fs.unlinkSync(getLockPath());
  } catch {
    // Already released
  }
}

export async function withRegistry(
  fn: (registry: Registry) => void
): Promise<Registry> {
  await acquireLock();
  try {
    const registry = await readRegistry();
    fn(registry);
    writeRegistry(registry);
    return registry;
  } finally {
    releaseLock();
  }
}

export function findEntry(
  registry: Registry,
  id: number
): RegistryEntry | undefined {
  return registry.entries.find((e) => e.id === id);
}
