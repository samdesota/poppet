# Poppet CLI Design Spec

## Overview

Poppet is a lightweight Node.js CLI that manages long-running processes with a global registry. It lets you start commands, track them across directories, read their logs, and restart them. The primary use case is starting dev commands and letting Claude agents (or other terminals) inspect, restart, and read logs.

Published on npm. Installed globally via `npm install -g poppet`.

## State and Storage

All state lives under `~/.config/poppet/`:

- `registry.json` — Array of command entries plus a `nextId` counter.
- `logs/<id>.stdout.log` — Stdout for command with given ID.
- `logs/<id>.stderr.log` — Stderr for command with given ID.

The directory and files are created lazily on first use.

## Registry Entry Schema

```json
{
  "id": 3,
  "command": "node",
  "args": ["server.js"],
  "cwd": "/Users/sam/myproject",
  "pid": 48210,
  "startedAt": "2026-04-13T22:10:00.000Z",
  "status": "running"
}
```

`status` is one of: `"running"`, `"exited"`, `"stopped"`.

- `"running"` — Process was started and PID is (or was last known to be) alive.
- `"exited"` — Process died on its own (detected via liveness check).
- `"stopped"` — Process was explicitly killed via `poppet stop`.

## Commands

### `poppet run <cmd> [args...]`

Spawn the command **attached**. The process is registered in the registry and logs are written to disk, but stdout/stderr are also streamed to the current terminal. Ctrl+C sends SIGTERM to the child process and kills it.

Because the process is registered, other terminals can simultaneously use `poppet logs <id>` or `poppet attach <id>` to watch it.

### `poppet spawn <cmd> [args...]`

Spawn the command **detached**. The process is registered, logs go to disk, and poppet prints the assigned ID and exits immediately. The spawned process survives terminal close.

### `poppet list`

List commands started in the **current working directory**. Shows: ID, command + args, status, PID, started time.

Before displaying, poppet checks liveness of each process (signal 0) and updates the registry if any have died.

### `poppet list --all`

Same as `poppet list` but shows commands from all directories.

### `poppet logs <id>`

Print the stdout log for the given command ID. Flags:

- `--stderr` — Print stderr log instead.
- `--follow` / `-f` — Tail the log in real-time (like `tail -f`).

### `poppet attach <id>`

Tail both stdout and stderr live for a running command. Ctrl+C detaches — the process keeps running.

### `poppet restart <id>`

Kill the process (SIGTERM), then re-run the same command in the same working directory. The entry keeps the same ID but gets a new PID, new `startedAt`, and fresh log files. The old log files are deleted.

The restarted process is spawned detached (same as `poppet spawn`).

### `poppet stop <id>`

Send SIGTERM to the process. Update status to `"stopped"`.

### `poppet remove <id>`

Remove a dead/exited/stopped entry from the registry and delete its log files. Refuses to remove a running process (must `poppet stop` first).

### `poppet clean`

Remove all non-running entries from the registry and delete their log files.

## Process Spawning

### Attached mode (`poppet run`)

- Use `child_process.spawn` with `stdio: ['inherit', 'pipe', 'pipe']`.
- Pipe stdout/stderr to both the terminal and log files simultaneously.
- Register SIGINT handler: on Ctrl+C, send SIGTERM to child, wait for exit, update registry status to `"stopped"`.
- Poppet stays alive for the duration of the child process.

### Detached mode (`poppet spawn`)

- Use `child_process.spawn` with `detached: true` and `stdio: ['ignore', fd, fd]` where `fd` are file descriptors for the log files.
- Call `child.unref()` so poppet can exit immediately.
- Print the assigned ID to stdout.

## Liveness Checks

On `list`, `logs`, `attach`, and `restart`, poppet checks if a process is still alive by calling `process.kill(pid, 0)`:

- If it throws with `ESRCH`, the process is dead — update status to `"exited"`.
- If it throws with `EPERM`, the process exists but we can't signal it — treat as alive.
- If it succeeds, the process is alive.

## ID Assignment

IDs are simple auto-incrementing integers starting at 1. The `nextId` counter is stored in `registry.json`. IDs are never reused (even after `remove` or `clean`).

## Registry File Locking

Multiple poppet instances may read/write the registry concurrently (e.g., two terminals both running `poppet spawn`). Use a simple lockfile (`~/.config/poppet/registry.lock`) with retry to prevent corruption. The lock is held only for the duration of the read-modify-write cycle.

## Tech Stack

- TypeScript, compiled to JavaScript.
- `commander` for argument parsing.
- Zero other runtime dependencies.
- `tsup` for building.

## File Structure

```
poppet/
├── src/
│   ├── cli.ts          # Commander setup, command definitions
│   ├── registry.ts     # Read/write/update registry.json, file locking
│   ├── process.ts      # Spawn, stop, restart, liveness check
│   └── logs.ts         # Log file paths, tail/attach streaming
├── package.json
├── tsconfig.json
├── bin/
│   └── poppet.js       # Entry point: #!/usr/bin/env node, requires compiled cli
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-04-14-poppet-cli-design.md
```

## Error Handling

- If `<id>` doesn't exist in the registry: print error and exit with code 1.
- If `poppet attach` or `poppet logs -f` targets a dead process: print remaining logs, then exit.
- If `poppet restart` targets a dead process: just re-run it (no need to kill).
- If `~/.config/poppet/` doesn't exist: create it.
- If `registry.json` doesn't exist: create it with `{ "nextId": 1, "entries": [] }`.
