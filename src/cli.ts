import { Command } from "commander";

const program = new Command();

program
  .name("poppet")
  .description("Lightweight CLI process manager")
  .version("0.1.0")
  .enablePositionalOptions();

program
  .command("spawn")
  .description("Spawn a command detached in the background")
  .argument("<cmd>", "Command to run")
  .argument("[args...]", "Arguments for the command")
  .passThroughOptions()
  .action(async (cmd: string, args: string[]) => {
    const { spawnDetached } = await import("./process.js");
    const entry = await spawnDetached(cmd, args, process.cwd());
    console.log(
      `Spawned [${entry.id}] ${entry.command} ${entry.args.join(" ")} (PID ${entry.pid})`
    );
  });

program
  .command("run")
  .description("Run a command attached to the terminal")
  .argument("<cmd>", "Command to run")
  .argument("[args...]", "Arguments for the command")
  .passThroughOptions()
  .action(async (cmd: string, args: string[]) => {
    const { spawnAttached } = await import("./process.js");
    await spawnAttached(cmd, args, process.cwd());
  });

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
      const cwdStr =
        e.cwd.length > 28 ? "..." + e.cwd.slice(-25) : e.cwd;
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

program
  .command("logs")
  .description("Print logs for a command")
  .argument("<id>", "Command ID")
  .option("--stderr", "Show stderr instead of stdout")
  .option("-f, --follow", "Follow log output in real-time")
  .action(
    async (idStr: string, opts: { stderr?: boolean; follow?: boolean }) => {
      const id = parseInt(idStr, 10);
      const { readRegistry } = await import("./registry.js");
      const { refreshStatus } = await import("./process.js");
      const {
        getStdoutLogPath,
        getStderrLogPath,
        tailLogFile,
      } = await import("./logs.js");
      const fs = await import("node:fs");

      await refreshStatus();
      const registry = await readRegistry();
      const entry = registry.entries.find((e) => e.id === id);
      if (!entry) {
        console.error(`No command with ID ${id}`);
        process.exit(1);
      }

      const logPath = opts.stderr
        ? getStderrLogPath(id)
        : getStdoutLogPath(id);

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
    }
  );

program
  .command("attach")
  .description("Attach to a running command's output")
  .argument("<id>", "Command ID")
  .action(async (idStr: string) => {
    const id = parseInt(idStr, 10);
    const { readRegistry } = await import("./registry.js");
    const { refreshStatus } = await import("./process.js");
    const {
      getStdoutLogPath,
      getStderrLogPath,
      tailLogFile,
    } = await import("./logs.js");

    await refreshStatus();
    const registry = await readRegistry();
    const entry = registry.entries.find((e) => e.id === id);
    if (!entry) {
      console.error(`No command with ID ${id}`);
      process.exit(1);
    }

    if (entry.status !== "running") {
      console.error(
        `Command ${id} is not running (status: ${entry.status})`
      );
      process.exit(1);
    }

    const ac = new AbortController();
    process.on("SIGINT", () => {
      ac.abort();
      process.exit(0);
    });

    tailLogFile(getStdoutLogPath(id), ac.signal);
    tailLogFile(getStderrLogPath(id), ac.signal);
  });

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

program
  .command("restart")
  .description("Restart a command")
  .argument("<id>", "Command ID")
  .action(async (idStr: string) => {
    const id = parseInt(idStr, 10);
    const { restartProcess } = await import("./process.js");
    try {
      const entry = await restartProcess(id);
      console.log(
        `Restarted [${entry.id}] ${entry.command} ${entry.args.join(" ")} (PID ${entry.pid})`
      );
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("remove")
  .description("Remove a dead command from the registry")
  .argument("<id>", "Command ID")
  .action(async (idStr: string) => {
    const id = parseInt(idStr, 10);
    const { readRegistry, withRegistry } = await import("./registry.js");
    const { refreshStatus } = await import("./process.js");
    const { deleteLogFiles } = await import("./logs.js");

    await refreshStatus();
    const registry = await readRegistry();
    const entry = registry.entries.find((e) => e.id === id);
    if (!entry) {
      console.error(`No command with ID ${id}`);
      process.exit(1);
    }
    if (entry.status === "running") {
      console.error(
        `Command ${id} is still running. Stop it first with: poppet stop ${id}`
      );
      process.exit(1);
    }

    await withRegistry((reg) => {
      reg.entries = reg.entries.filter((e) => e.id !== id);
    });
    deleteLogFiles(id);
    console.log(`Removed command ${id}`);
  });

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

program.parse();
