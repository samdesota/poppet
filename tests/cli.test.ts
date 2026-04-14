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
        try {
          process.kill(entry.pid, "SIGTERM");
        } catch {}
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

    // Logs should contain the restart marker
    execFileSync("sleep", ["0.5"]);
    const logs = poppet("logs", "1");
    expect(logs).toContain("--- restarted at");
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
    poppet("spawn", "bash", "-c", "echo hello world");
    // Give echo a moment to finish
    execFileSync("sleep", ["0.5"]);
    const logs = poppet("logs", "1");
    expect(logs).toContain("hello world");
  });

  it("passes through flags to spawned commands without consuming them", () => {
    poppet("spawn", "node", "-e", "console.log('flag-test')");
    execFileSync("sleep", ["0.5"]);
    const logs = poppet("logs", "1");
    expect(logs).toContain("flag-test");
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
