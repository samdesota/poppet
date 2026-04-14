import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isAlive, spawnDetached, stopProcess } from "../src/process.js";
import { readRegistry } from "../src/registry.js";

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

    // Cleanup
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
