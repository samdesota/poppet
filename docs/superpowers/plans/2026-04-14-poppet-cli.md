# Poppet CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI that manages long-running processes with a global registry, supporting attached/detached spawning, log reading, restart, and process lifecycle management.

**Architecture:** Four modules — registry (JSON state + file locking), process (spawn/stop/liveness), logs (file paths + tailing), and cli (commander wiring). All state in `~/.config/poppet/`. Tests use a temp directory override via `POPPET_CONFIG_DIR` env var.

**Tech Stack:** TypeScript, commander, tsup, vitest for testing.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bin/poppet.js`
- Create: `src/cli.ts`
- Create: `src/config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "poppet",
  "version": "0.1.0",
  "description": "Lightweight CLI process manager with global registry",
  "type": "module",
  "bin": {
    "poppet": "./bin/poppet.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "files": [
    "dist",
    "bin"
  ],
  "keywords": ["cli", "process-manager"],
  "license": "MIT"
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
});
```

- [ ] **Step 4: Create `bin/poppet.js`**

```js
#!/usr/bin/env node
import "../dist/cli.js";
```

- [ ] **Step 5: Create `src/config.ts`**

This module provides the config directory path. It reads `POPPET_CONFIG_DIR` env var for testing, defaulting to `~/.config/poppet`.

```ts
import path from "node:path";
import os from "node:os";

export function getConfigDir(): string {
  return (
    process.env.POPPET_CONFIG_DIR ??
    path.join(os.homedir(), ".config", "poppet")
  );
}

export function getLogsDir(): string {
  return path.join(getConfigDir(), "logs");
}

export function getRegistryPath(): string {
  return path.join(getConfigDir(), "registry.json");
}

export function getLockPath(): string {
  return path.join(getConfigDir(), "registry.lock");
}
```

- [ ] **Step 6: Create stub `src/cli.ts`**

```ts
import { Command } from "commander";

const program = new Command();

program
  .name("poppet")
  .description("Lightweight CLI process manager")
  .version("0.1.0");

program.parse();
```

- [ ] **Step 7: Install dependencies and verify build**

Run:
```bash
npm install commander
npm install -D typescript tsup vitest @types/node
npm run build
```
Expected: Build succeeds, `dist/cli.js` is created.

- [ ] **Step 8: Verify bin entry point works**

Run:
```bash
node bin/poppet.js --version
```
Expected: Prints `0.1.0`

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts bin/poppet.js src/cli.ts src/config.ts
git commit -m "feat: scaffold poppet CLI project"
```

---

### Task 2: Registry Module

**Files:**
- Create: `src/registry.ts`
- Create: `tests/registry.test.ts`

The registry module handles reading, writing, and locking `registry.json`. All operations go through `withRegistry()` which acquires a lockfile, reads the JSON, calls a callback, writes the result, and releases the lock.

- [ ] **Step 1: Write tests for registry**

Create `tests/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRegistry, withRegistry, type RegistryEntry } from "../src/registry.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poppet-test-"));
  process.env.POPPET_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.POPPET_CONFIG_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readRegistry", () => {
  it("returns empty registry when no file exists", async () => {
    const reg = await readRegistry();
    expect(reg.nextId).toBe(1);
    expect(reg.entries).toEqual([]);
  });

  it("reads existing registry", async () => {
    const data = { nextId: 5, entries: [{ id: 1, command: "node", args: ["server.js"], cwd: "/tmp", pid: 123, startedAt: "2026-04-14T00:00:00.000Z", status: "running" as const }] };
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "registry.json"), JSON.stringify(data));
    const reg = await readRegistry();
    expect(reg.nextId).toBe(5);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0].command).toBe("node");
  });
});

describe("withRegistry", () => {
  it("creates config dir and registry file on first write", async () => {
    const logsDir = path.join(tmpDir, "logs");
    await withRegistry((reg) => {
      reg.entries.push({
        id: reg.nextId,
        command: "echo",
        args: ["hello"],
        cwd: "/tmp",
        pid: 999,
        startedAt: new Date().toISOString(),
        status: "running",
      });
      reg.nextId++;
    });
    const reg = await readRegistry();
    expect(reg.nextId).toBe(2);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0].id).toBe(1);
  });

  it("handles concurrent writes without corruption", async () => {
    const writes = Array.from({ length: 5 }, (_, i) =>
      withRegistry((reg) => {
        reg.entries.push({
          id: reg.nextId,
          command: "cmd",
          args: [String(i)],
          cwd: "/tmp",
          pid: 1000 + i,
          startedAt: new Date().toISOString(),
          status: "running",
        });
        reg.nextId++;
      })
    );
    await Promise.all(writes);
    const reg = await readRegistry();
    expect(reg.entries).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/registry.test.ts`
Expected: FAIL — module `../src/registry.js` doesn't exist.

- [ ] **Step 3: Implement `src/registry.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { getConfigDir, getLogsDir, getRegistryPath, getLockPath } from "./config.js";

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

export async function withRegistry(fn: (registry: Registry) => void): Promise<Registry> {
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

export function findEntry(registry: Registry, id: number): RegistryEntry | undefined {
  return registry.entries.find((e) => e.id === id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/registry.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts tests/registry.test.ts
git commit -m "feat: implement registry module with file locking"
```

---

### Task 3: Logs Module

**Files:**
- Create: `src/logs.ts`
- Create: `tests/logs.test.ts`

- [ ] **Step 1: Write tests for logs module**

Create `tests/logs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStdoutLogPath, getStderrLogPath, deleteLogFiles } from "../src/logs.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poppet-test-"));
  process.env.POPPET_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.POPPET_CONFIG_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("log paths", () => {
  it("returns correct stdout log path", () => {
    expect(getStdoutLogPath(3)).toBe(path.join(tmpDir, "logs", "3.stdout.log"));
  });

  it("returns correct stderr log path", () => {
    expect(getStderrLogPath(3)).toBe(path.join(tmpDir, "logs", "3.stderr.log"));
  });
});

describe("deleteLogFiles", () => {
  it("deletes log files if they exist", () => {
    const logsDir = path.join(tmpDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const stdoutPath = path.join(logsDir, "1.stdout.log");
    const stderrPath = path.join(logsDir, "1.stderr.log");
    fs.writeFileSync(stdoutPath, "some output");
    fs.writeFileSync(stderrPath, "some error");
    deleteLogFiles(1);
    expect(fs.existsSync(stdoutPath)).toBe(false);
    expect(fs.existsSync(stderrPath)).toBe(false);
  });

  it("does not throw if log files don't exist", () => {
    expect(() => deleteLogFiles(999)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/logs.test.ts`
Expected: FAIL — module `../src/logs.js` doesn't exist.

- [ ] **Step 3: Implement `src/logs.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { getLogsDir } from "./config.js";

export function getStdoutLogPath(id: number): string {
  return path.join(getLogsDir(), `${id}.stdout.log`);
}

export function getStderrLogPath(id: number): string {
  return path.join(getLogsDir(), `${id}.stderr.log`);
}

export function deleteLogFiles(id: number): void {
  for (const logPath of [getStdoutLogPath(id), getStderrLogPath(id)]) {
    try {
      fs.unlinkSync(logPath);
    } catch {
      // File doesn't exist — fine
    }
  }
}

export function tailLogFile(logPath: string, signal: AbortSignal): void {
  // Print existing content
  try {
    const content = fs.readFileSync(logPath, "utf-8");
    if (content) process.stdout.write(content);
  } catch {
    // File doesn't exist yet — fine
  }

  // Watch for new content
  const watcher = fs.watch(path.dirname(logPath), (_, filename) => {
    if (filename === path.basename(logPath)) {
      try {
        const content = fs.readFileSync(logPath, "utf-8");
        // This is a simple approach — read the whole file each time.
        // For a production-grade tail, track the byte offset.
        process.stdout.write(content);
      } catch {
        // File was deleted
      }
    }
  });

  signal.addEventListener("abort", () => watcher.close());
}
```

Wait — the `tailLogFile` re-reads the whole file each time. Let me use a proper byte-offset approach:

```ts
export function tailLogFile(logPath: string, signal: AbortSignal): void {
  let offset = 0;

  function readNew(): void {
    try {
      const fd = fs.openSync(logPath, "r");
      const stat = fs.fstatSync(fd);
      if (stat.size > offset) {
        const buf = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        process.stdout.write(buf);
        offset = stat.size;
      }
      fs.closeSync(fd);
    } catch {
      // File doesn't exist yet — fine
    }
  }

  // Print existing content
  readNew();

  // Poll for new content (more reliable than fs.watch across platforms)
  const interval = setInterval(readNew, 100);

  signal.addEventListener("abort", () => clearInterval(interval));
}
```

Replace the first `tailLogFile` implementation with this one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/logs.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logs.ts tests/logs.test.ts
git commit -m "feat: implement logs module with tail support"
```

---

### Task 4: Process Module

**Files:**
- Create: `src/process.ts`
- Create: `tests/process.test.ts`

- [ ] **Step 1: Write tests for process module**

Create `tests/process.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isAlive, spawnDetached, stopProcess } from "../src/process.js";
import { readRegistry, withRegistry } from "../src/registry.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poppet-test-"));
  process.env.POPPET_CONFIG_DIR = tmpDir;
  fs.mkdirSync(path.join(tmpDir, "logs"), { recursive: true });
});

afterEach(() => {
  delete process.env.POPPET_CONFIG_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isAlive", () => {
  it("returns true for the current process", () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it("returns false for a non-existent PID", () => {
    expect(isAlive(2147483647)).toBe(false);
  });
});

describe("spawnDetached", () => {
  it("spawns a process and registers it", async () => {
    const entry = await spawnDetached("sleep", ["60"], os.tmpdir());
    expect(entry.id).toBe(1);
    expect(entry.command).toBe("sleep");
    expect(entry.status).toBe("running");
    expect(isAlive(entry.pid)).toBe(true);

    // Cleanup: kill the spawned process
    process.kill(entry.pid, "SIGTERM");
  });

  it("creates log files", async () => {
    const entry = await spawnDetached("echo", ["hello"], os.tmpdir());
    // Give it a moment to write
    await new Promise((r) => setTimeout(r, 200));
    const stdoutLog = path.join(tmpDir, "logs", `${entry.id}.stdout.log`);
    expect(fs.existsSync(stdoutLog)).toBe(true);
  });

  it("auto-increments IDs", async () => {
    const e1 = await spawnDetached("sleep", ["60"], os.tmpdir());
    const e2 = await spawnDetached("sleep", ["60"], os.tmpdir());
    expect(e1.id).toBe(1);
    expect(e2.id).toBe(2);
    process.kill(e1.pid, "SIGTERM");
    process.kill(e2.pid, "SIGTERM");
  });
});

describe("stopProcess", () => {
  it("stops a running process", async () => {
    const entry = await spawnDetached("sleep", ["60"], os.tmpdir());
    await stopProcess(entry.id);
    // Give it a moment to die
    await new Promise((r) => setTimeout(r, 200));
    expect(isAlive(entry.pid)).toBe(false);
    const reg = await readRegistry();
    const updated = reg.entries.find((e) => e.id === entry.id);
    expect(updated?.status).toBe("stopped");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/process.test.ts`
Expected: FAIL — module `../src/process.js` doesn't exist.

- [ ] **Step 3: Implement `src/process.ts`**

```ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import { getStdoutLogPath, getStderrLogPath } from "./logs.js";
import { withRegistry, findEntry, readRegistry, type RegistryEntry } from "./registry.js";
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
  let childPid!: number;

  await withRegistry((registry) => {
    id = registry.nextId;
    registry.nextId++;

    fs.mkdirSync(getLogsDir(), { recursive: true });

    registry.entries.push({
      id,
      command,
      args,
      cwd,
      pid: 0, // Will be updated after spawn
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

  childPid = child.pid!;

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
    child.on("close", async (code) => {
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
  if (entry.status !== "running") throw new Error(`Command ${id} is not running`);

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
    // Brief wait for process to die
    await new Promise((r) => setTimeout(r, 500));
  }

  // Delete old logs
  const { deleteLogFiles } = await import("./logs.js");
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/process.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/process.ts tests/process.test.ts
git commit -m "feat: implement process module with spawn, stop, restart"
```

---

### Task 5: CLI Wiring — `run` and `spawn` Commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Wire up `spawn` and `run` commands in `src/cli.ts`**

Replace the contents of `src/cli.ts`:

```ts
import { Command } from "commander";

const program = new Command();

program
  .name("poppet")
  .description("Lightweight CLI process manager")
  .version("0.1.0");

program
  .command("spawn")
  .description("Spawn a command detached in the background")
  .argument("<cmd>", "Command to run")
  .argument("[args...]", "Arguments for the command")
  .action(async (cmd: string, args: string[]) => {
    const { spawnDetached } = await import("./process.js");
    const entry = await spawnDetached(cmd, args, process.cwd());
    console.log(`Spawned [${entry.id}] ${entry.command} ${entry.args.join(" ")} (PID ${entry.pid})`);
  });

program
  .command("run")
  .description("Run a command attached to the terminal")
  .argument("<cmd>", "Command to run")
  .argument("[args...]", "Arguments for the command")
  .action(async (cmd: string, args: string[]) => {
    const { spawnAttached } = await import("./process.js");
    await spawnAttached(cmd, args, process.cwd());
  });

program.parse();
```

- [ ] **Step 2: Build and test `spawn`**

Run:
```bash
npm run build
node bin/poppet.js spawn sleep 30
```
Expected: Prints something like `Spawned [1] sleep 30 (PID 12345)` and returns immediately.

- [ ] **Step 3: Verify the process is running**

Run:
```bash
ps -p <PID from above>
```
Expected: Shows the `sleep 30` process.

- [ ] **Step 4: Build and test `run`**

Run:
```bash
node bin/poppet.js run echo hello
```
Expected: Prints `hello` and exits.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire up run and spawn commands"
```

---

### Task 6: CLI Wiring — `list` Command

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `list` command to `src/cli.ts`**

Add after the `run` command definition:

```ts
program
  .command("list")
  .description("List running commands")
  .option("-a, --all", "List commands from all directories")
  .action(async (opts: { all?: boolean }) => {
    const { refreshStatus } = await import("./process.js");
    const { readRegistry } = await import("./registry.js");

    await refreshStatus();
    const registry = await readRegistry();

    let entries = registry.entries;
    if (!opts.all) {
      const cwd = process.cwd();
      entries = entries.filter((e) => e.cwd === cwd);
    }

    if (entries.length === 0) {
      console.log("No commands registered.");
      return;
    }

    console.log(
      "ID".padEnd(6) +
      "STATUS".padEnd(10) +
      "PID".padEnd(10) +
      "STARTED".padEnd(22) +
      "CWD".padEnd(30) +
      "COMMAND"
    );

    for (const e of entries) {
      const started = new Date(e.startedAt).toLocaleString();
      const cmdStr = [e.command, ...e.args].join(" ");
      const cwdStr = e.cwd.length > 28 ? "..." + e.cwd.slice(-25) : e.cwd;
      console.log(
        String(e.id).padEnd(6) +
        e.status.padEnd(10) +
        String(e.pid).padEnd(10) +
        started.padEnd(22) +
        cwdStr.padEnd(30) +
        cmdStr
      );
    }
  });
```

- [ ] **Step 2: Build and test**

Run:
```bash
npm run build
node bin/poppet.js spawn sleep 120
node bin/poppet.js list --all
```
Expected: Shows the sleep command with status `running`.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add list command with directory filtering"
```

---

### Task 7: CLI Wiring — `logs` and `attach` Commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `logs` command to `src/cli.ts`**

```ts
program
  .command("logs")
  .description("Print logs for a command")
  .argument("<id>", "Command ID")
  .option("--stderr", "Show stderr instead of stdout")
  .option("-f, --follow", "Follow log output in real-time")
  .action(async (idStr: string, opts: { stderr?: boolean; follow?: boolean }) => {
    const id = parseInt(idStr, 10);
    const { readRegistry } = await import("./registry.js");
    const { refreshStatus } = await import("./process.js");
    const { getStdoutLogPath, getStderrLogPath, tailLogFile } = await import("./logs.js");
    const fs = await import("node:fs");

    await refreshStatus();
    const registry = await readRegistry();
    const entry = registry.entries.find((e) => e.id === id);
    if (!entry) {
      console.error(`No command with ID ${id}`);
      process.exit(1);
    }

    const logPath = opts.stderr ? getStderrLogPath(id) : getStdoutLogPath(id);

    if (opts.follow) {
      const ac = new AbortController();
      process.on("SIGINT", () => {
        ac.abort();
        process.exit(0);
      });
      tailLogFile(logPath, ac.signal);
    } else {
      try {
        const content = fs.readFileSync(logPath, "utf-8");
        process.stdout.write(content);
      } catch {
        // No log file yet
      }
    }
  });
```

- [ ] **Step 2: Add `attach` command to `src/cli.ts`**

```ts
program
  .command("attach")
  .description("Attach to a running command's output")
  .argument("<id>", "Command ID")
  .action(async (idStr: string) => {
    const id = parseInt(idStr, 10);
    const { readRegistry } = await import("./registry.js");
    const { refreshStatus, isAlive } = await import("./process.js");
    const { getStdoutLogPath, getStderrLogPath, tailLogFile } = await import("./logs.js");

    await refreshStatus();
    const registry = await readRegistry();
    const entry = registry.entries.find((e) => e.id === id);
    if (!entry) {
      console.error(`No command with ID ${id}`);
      process.exit(1);
    }

    if (entry.status !== "running") {
      console.error(`Command ${id} is not running (status: ${entry.status})`);
      process.exit(1);
    }

    const ac = new AbortController();
    process.on("SIGINT", () => {
      ac.abort();
      process.exit(0);
    });

    // Tail both stdout and stderr
    tailLogFile(getStdoutLogPath(id), ac.signal);
    tailLogFile(getStderrLogPath(id), ac.signal);
  });
```

- [ ] **Step 3: Build and test**

Run:
```bash
npm run build
node bin/poppet.js spawn bash -c "for i in 1 2 3; do echo tick \$i; sleep 1; done"
# Note the ID printed
sleep 4
node bin/poppet.js logs <id>
```
Expected: Shows `tick 1`, `tick 2`, `tick 3`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add logs and attach commands"
```

---

### Task 8: CLI Wiring — `stop`, `restart`, `remove`, `clean` Commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `stop` command**

```ts
program
  .command("stop")
  .description("Stop a running command")
  .argument("<id>", "Command ID")
  .action(async (idStr: string) => {
    const id = parseInt(idStr, 10);
    const { stopProcess } = await import("./process.js");
    try {
      await stopProcess(id);
      console.log(`Stopped command ${id}`);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });
```

- [ ] **Step 2: Add `restart` command**

```ts
program
  .command("restart")
  .description("Restart a command")
  .argument("<id>", "Command ID")
  .action(async (idStr: string) => {
    const id = parseInt(idStr, 10);
    const { restartProcess } = await import("./process.js");
    try {
      const entry = await restartProcess(id);
      console.log(`Restarted [${entry.id}] ${entry.command} ${entry.args.join(" ")} (PID ${entry.pid})`);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Add `remove` command**

```ts
program
  .command("remove")
  .description("Remove a dead command from the registry")
  .argument("<id>", "Command ID")
  .action(async (idStr: string) => {
    const id = parseInt(idStr, 10);
    const { readRegistry, withRegistry } = await import("./registry.js");
    const { refreshStatus, isAlive } = await import("./process.js");
    const { deleteLogFiles } = await import("./logs.js");

    await refreshStatus();
    const registry = await readRegistry();
    const entry = registry.entries.find((e) => e.id === id);
    if (!entry) {
      console.error(`No command with ID ${id}`);
      process.exit(1);
    }
    if (entry.status === "running") {
      console.error(`Command ${id} is still running. Stop it first with: poppet stop ${id}`);
      process.exit(1);
    }

    await withRegistry((reg) => {
      reg.entries = reg.entries.filter((e) => e.id !== id);
    });
    deleteLogFiles(id);
    console.log(`Removed command ${id}`);
  });
```

- [ ] **Step 4: Add `clean` command**

```ts
program
  .command("clean")
  .description("Remove all non-running commands from the registry")
  .action(async () => {
    const { refreshStatus } = await import("./process.js");
    const { withRegistry } = await import("./registry.js");
    const { deleteLogFiles } = await import("./logs.js");

    await refreshStatus();

    let removed = 0;
    await withRegistry((reg) => {
      const dead = reg.entries.filter((e) => e.status !== "running");
      for (const e of dead) {
        deleteLogFiles(e.id);
      }
      removed = dead.length;
      reg.entries = reg.entries.filter((e) => e.status === "running");
    });
    console.log(`Cleaned ${removed} entries.`);
  });
```

- [ ] **Step 5: Build and test the full workflow**

Run:
```bash
npm run build
node bin/poppet.js spawn sleep 120
# Note the ID (e.g., 1)
node bin/poppet.js list --all
node bin/poppet.js stop 1
node bin/poppet.js list --all
# Should show status "stopped"
node bin/poppet.js restart 1
node bin/poppet.js list --all
# Should show status "running" with new PID
node bin/poppet.js stop 1
node bin/poppet.js remove 1
node bin/poppet.js list --all
# Should show no entries (or "No commands registered")
```

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add stop, restart, remove, and clean commands"
```

---

### Task 9: End-to-End Integration Tests

**Files:**
- Create: `tests/cli.test.ts`

- [ ] **Step 1: Write integration tests**

Create `tests/cli.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;
const bin = path.resolve("bin/poppet.js");

function poppet(...args: string[]): string {
  return execFileSync("node", [bin, ...args], {
    env: { ...process.env, POPPET_CONFIG_DIR: tmpDir },
    encoding: "utf-8",
    cwd: os.tmpdir(),
  }).trim();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poppet-e2e-"));
});

afterEach(() => {
  // Kill any leftover processes
  try {
    const regPath = path.join(tmpDir, "registry.json");
    if (fs.existsSync(regPath)) {
      const reg = JSON.parse(fs.readFileSync(regPath, "utf-8"));
      for (const entry of reg.entries) {
        try { process.kill(entry.pid, "SIGTERM"); } catch {}
      }
    }
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("poppet CLI", () => {
  it("spawn registers a process and list shows it", () => {
    const out = poppet("spawn", "sleep", "60");
    expect(out).toMatch(/Spawned \[1\] sleep 60/);

    const list = poppet("list", "--all");
    expect(list).toContain("sleep 60");
    expect(list).toContain("running");
  });

  it("stop changes status to stopped", () => {
    poppet("spawn", "sleep", "60");
    poppet("stop", "1");
    const list = poppet("list", "--all");
    expect(list).toContain("stopped");
  });

  it("restart gives a new PID", () => {
    const out1 = poppet("spawn", "sleep", "60");
    const pid1 = out1.match(/PID (\d+)/)?.[1];

    const out2 = poppet("restart", "1");
    const pid2 = out2.match(/PID (\d+)/)?.[1];

    expect(pid1).toBeDefined();
    expect(pid2).toBeDefined();
    expect(pid1).not.toBe(pid2);
  });

  it("remove deletes entry and logs", () => {
    poppet("spawn", "sleep", "60");
    poppet("stop", "1");
    poppet("remove", "1");
    const list = poppet("list", "--all");
    expect(list).toContain("No commands registered");
  });

  it("clean removes all dead entries", () => {
    poppet("spawn", "sleep", "60");
    poppet("spawn", "sleep", "60");
    poppet("stop", "1");
    poppet("stop", "2");
    const out = poppet("clean");
    expect(out).toContain("Cleaned 2 entries");
    const list = poppet("list", "--all");
    expect(list).toContain("No commands registered");
  });

  it("logs shows command output", () => {
    poppet("spawn", "echo", "hello world");
    // Give echo a moment to finish
    execFileSync("sleep", ["0.5"]);
    const logs = poppet("logs", "1");
    expect(logs).toContain("hello world");
  });

  it("list without --all filters by cwd", () => {
    // Spawn in os.tmpdir() (set as cwd in poppet helper)
    poppet("spawn", "sleep", "60");
    // List from a different cwd
    const out = execFileSync("node", [bin, "list"], {
      env: { ...process.env, POPPET_CONFIG_DIR: tmpDir },
      encoding: "utf-8",
      cwd: os.homedir(),
    }).trim();
    expect(out).toContain("No commands registered");
  });
});
```

- [ ] **Step 2: Build and run integration tests**

Run:
```bash
npm run build
npx vitest run tests/cli.test.ts
```
Expected: All tests PASS.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/cli.test.ts
git commit -m "test: add end-to-end CLI integration tests"
```

---

### Task 10: GitHub Repo and Final Polish

**Files:**
- Create: `.gitignore`
- Modify: `package.json` (add repository field)

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
*.tgz
```

- [ ] **Step 2: Create GitHub repo and push**

```bash
gh repo create poppet --public --source=. --remote=origin --push
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add gitignore and push to GitHub"
git push
```
