import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRegistry, withRegistry } from "../src/registry.js";

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
    const data = {
      nextId: 5,
      entries: [
        {
          id: 1,
          command: "node",
          args: ["server.js"],
          cwd: "/tmp",
          env: {},
          pid: 123,
          startedAt: "2026-04-14T00:00:00.000Z",
          status: "running" as const,
        },
      ],
    };
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "registry.json"),
      JSON.stringify(data)
    );
    const reg = await readRegistry();
    expect(reg.nextId).toBe(5);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0].command).toBe("node");
  });
});

describe("withRegistry", () => {
  it("creates config dir and registry file on first write", async () => {
    await withRegistry((reg) => {
      reg.entries.push({
        id: reg.nextId,
        command: "echo",
        args: ["hello"],
        cwd: "/tmp",
        env: {},
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
          env: {},
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
