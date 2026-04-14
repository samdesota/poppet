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
