import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getStdoutLogPath,
  getStderrLogPath,
  deleteLogFiles,
} from "../src/logs.js";

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
