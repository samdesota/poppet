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
