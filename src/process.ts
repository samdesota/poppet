import { spawn } from "node:child_process";
import fs from "node:fs";
import { getStdoutLogPath, getStderrLogPath, deleteLogFiles } from "./logs.js";
import {
  withRegistry,
  findEntry,
  readRegistry,
  type RegistryEntry,
} from "./registry.js";
import { getLogsDir } from "./config.js";

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err.code === "EPERM") return true;
    return false;
  }
}

export async function refreshStatus(): Promise<void> {
  await withRegistry((registry) => {
    for (const entry of registry.entries) {
      if (entry.status === "running" && !isAlive(entry.pid)) {
        entry.status = "exited";
      }
    }
  });
}

export async function spawnDetached(
  command: string,
  args: string[],
  cwd: string
): Promise<RegistryEntry> {
  let entry!: RegistryEntry;

  await withRegistry((registry) => {
    const id = registry.nextId;
    registry.nextId++;

    fs.mkdirSync(getLogsDir(), { recursive: true });
    const stdoutFd = fs.openSync(getStdoutLogPath(id), "w");
    const stderrFd = fs.openSync(getStderrLogPath(id), "w");

    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });

    child.unref();
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);

    entry = {
      id,
      command,
      args,
      cwd,
      pid: child.pid!,
      startedAt: new Date().toISOString(),
      status: "running",
    };

    registry.entries.push(entry);
  });

  return entry;
}

export async function spawnAttached(
  command: string,
  args: string[],
  cwd: string
): Promise<void> {
  let id!: number;

  await withRegistry((registry) => {
    id = registry.nextId;
    registry.nextId++;

    fs.mkdirSync(getLogsDir(), { recursive: true });

    registry.entries.push({
      id,
      command,
      args,
      cwd,
      pid: 0,
      startedAt: new Date().toISOString(),
      status: "running",
    });
  });

  const stdoutLog = fs.createWriteStream(getStdoutLogPath(id));
  const stderrLog = fs.createWriteStream(getStderrLogPath(id));

  const child = spawn(command, args, {
    cwd,
    stdio: ["inherit", "pipe", "pipe"],
  });

  const childPid = child.pid!;

  // Update PID in registry
  await withRegistry((registry) => {
    const entry = findEntry(registry, id);
    if (entry) entry.pid = childPid;
  });

  child.stdout!.on("data", (data: Buffer) => {
    process.stdout.write(data);
    stdoutLog.write(data);
  });

  child.stderr!.on("data", (data: Buffer) => {
    process.stderr.write(data);
    stderrLog.write(data);
  });

  // Ctrl+C → kill the child
  const sigintHandler = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", sigintHandler);

  return new Promise<void>((resolve) => {
    child.on("close", async () => {
      process.removeListener("SIGINT", sigintHandler);
      stdoutLog.close();
      stderrLog.close();
      await withRegistry((registry) => {
        const entry = findEntry(registry, id);
        if (entry) entry.status = "stopped";
      });
      resolve();
    });
  });
}

export async function stopProcess(id: number): Promise<void> {
  const registry = await readRegistry();
  const entry = findEntry(registry, id);
  if (!entry) throw new Error(`No command with ID ${id}`);
  if (entry.status !== "running")
    throw new Error(`Command ${id} is not running`);

  if (isAlive(entry.pid)) {
    process.kill(entry.pid, "SIGTERM");
  }

  await withRegistry((reg) => {
    const e = findEntry(reg, id);
    if (e) e.status = "stopped";
  });
}

export async function restartProcess(id: number): Promise<RegistryEntry> {
  const registry = await readRegistry();
  const entry = findEntry(registry, id);
  if (!entry) throw new Error(`No command with ID ${id}`);

  // Kill if still running
  if (entry.status === "running" && isAlive(entry.pid)) {
    process.kill(entry.pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }

  // Delete old logs
  deleteLogFiles(id);

  // Spawn new detached process
  fs.mkdirSync(getLogsDir(), { recursive: true });
  const stdoutFd = fs.openSync(getStdoutLogPath(id), "w");
  const stderrFd = fs.openSync(getStderrLogPath(id), "w");

  const child = spawn(entry.command, entry.args, {
    cwd: entry.cwd,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
  });

  child.unref();
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);

  let updated!: RegistryEntry;
  await withRegistry((reg) => {
    const e = findEntry(reg, id);
    if (e) {
      e.pid = child.pid!;
      e.startedAt = new Date().toISOString();
      e.status = "running";
      updated = { ...e };
    }
  });

  return updated;
}
