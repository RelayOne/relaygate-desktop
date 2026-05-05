import { spawn, ChildProcess, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  GatewayControllerOpts,
  GatewayState,
  GatewayStatus,
  LogLine,
  BinaryValidation,
} from "./types";

// Maximum buffered log lines. Older lines are dropped silently with a
// single [truncated] marker emitted on overflow. Bounded so the gateway
// can't OOM the desktop process by logging verbosely.
const MAX_LOG_LINES = 5000;

// Curated PATH passed to the spawned gateway. We do NOT inherit the desktop's
// full env — that's a supply-chain hole. The user can override via a future
// settings UI; for now the curated list covers all standard install paths
// for the relaygate Go binary on macOS, Linux, and Windows.
const CURATED_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/usr/bin",
  "/bin",
  "/sbin",
  "/usr/sbin",
  // Windows-flavored too; harmless on POSIX since the path won't exist.
  "C:\\Program Files\\RelayGate",
  "C:\\Program Files (x86)\\RelayGate",
].join(process.platform === "win32" ? ";" : ":");

const VERSION_REGEX = /relaygate v(\d+\.\d+\.\d+)/i;
const LISTEN_REGEX = /relaygate listening/i;

export class GatewayController {
  private state: GatewayState = "stopped";
  private child: ChildProcess | null = null;
  private binaryPath: string | null = null;
  private binaryVersion: string | null = null;
  private startedAt: string | null = null;
  private listenAddr: string | null = null;
  private lastError: string | null = null;
  private readonly opts: GatewayControllerOpts;
  private readonly storagePath: string;
  private firstStderrSeen = false;

  constructor(opts: GatewayControllerOpts, storageDir: string) {
    this.opts = opts;
    this.storagePath = path.join(storageDir, "gateway-binary-path.txt");
    this.binaryPath = this.readStoredPath();
  }

  getStatus(): GatewayStatus {
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      binaryPath: this.binaryPath,
      binaryVersion: this.binaryVersion,
      startedAt: this.startedAt,
      listenAddr: this.listenAddr,
      lastError: this.lastError,
    };
  }

  getBinaryPath(): string | null {
    return this.binaryPath;
  }

  /**
   * Validate a candidate binary path and persist on success. Validation:
   *  1. File exists (fs.statSync).
   *  2. spawnSync `<path> --version` with 5s timeout.
   *  3. stdout/stderr contains `relaygate v<semver>`.
   * Returns { valid, version, error }.
   */
  setBinaryPath(absPath: string): BinaryValidation {
    if (!path.isAbsolute(absPath)) {
      return { valid: false, version: null, error: "path must be absolute" };
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch (err) {
      return {
        valid: false,
        version: null,
        error: `stat failed: ${(err as Error).message}`,
      };
    }
    if (!stat.isFile()) {
      return { valid: false, version: null, error: "not a regular file" };
    }
    const probe = spawnSync(absPath, ["--version"], {
      timeout: 5000,
      encoding: "utf8",
      env: { PATH: CURATED_PATH },
      shell: false,
    });
    if (probe.error) {
      return {
        valid: false,
        version: null,
        error: `spawn failed: ${probe.error.message}`,
      };
    }
    if (probe.signal) {
      return {
        valid: false,
        version: null,
        error: `--version killed by signal ${probe.signal}`,
      };
    }
    const combined = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
    const m = VERSION_REGEX.exec(combined);
    if (!m) {
      return {
        valid: false,
        version: null,
        error: `version not detected; output was: ${combined.slice(0, 200)}`,
      };
    }
    const version = m[1];
    this.binaryPath = absPath;
    this.binaryVersion = version;
    this.writeStoredPath(absPath);
    this.emitState();
    return { valid: true, version, error: null };
  }

  async start(configPath?: string): Promise<void> {
    if (this.state !== "stopped" && this.state !== "errored") {
      throw new Error(`cannot start in state ${this.state}`);
    }
    if (!this.binaryPath) {
      this.lastError = "no binary configured";
      this.transition("errored");
      throw new Error(this.lastError);
    }
    this.lastError = null;
    this.firstStderrSeen = false;
    this.listenAddr = null;
    this.transition("starting");

    const args: string[] = [];
    if (configPath) {
      args.push("--config", configPath);
    }

    let child: ChildProcess;
    try {
      child = spawn(this.binaryPath, args, {
        env: {
          PATH: CURATED_PATH,
          HOME: process.env.HOME ?? "",
          USERPROFILE: process.env.USERPROFILE ?? "",
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      this.lastError = `spawn failed: ${(err as Error).message}`;
      this.transition("errored");
      throw err;
    }
    this.child = child;
    this.startedAt = new Date().toISOString();

    // Line-buffer stderr (slog writes structured JSON there).
    if (child.stderr) {
      const rl = readline.createInterface({ input: child.stderr });
      let lineCount = 0;
      rl.on("line", (raw) => {
        if (!this.firstStderrSeen) {
          this.firstStderrSeen = true;
          this.transition("running");
        }
        if (lineCount === MAX_LOG_LINES) {
          this.opts.onLog({
            timestamp: new Date().toISOString(),
            level: "warn",
            msg: "[truncated] log buffer cap reached, older lines dropped",
            fields: {},
            raw: "",
          });
        }
        if (lineCount >= MAX_LOG_LINES) {
          // Drop. Cap bounded so onLog isn't spammed with truncate notices.
          return;
        }
        lineCount++;
        const parsed = parseLogLine(raw);
        if (LISTEN_REGEX.test(parsed.msg) || LISTEN_REGEX.test(raw)) {
          const addr = (parsed.fields["addr"] as string) ?? null;
          if (addr) {
            this.listenAddr = addr;
            this.emitState();
          }
        }
        this.opts.onLog(parsed);
      });
    }

    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.state === "stopping") {
        this.transition("stopped");
        return;
      }
      // Exit before "running" or unexpected exit while "running":
      this.lastError = `exited code=${code} signal=${signal ?? "none"}`;
      this.transition("errored");
    });

    child.on("error", (err) => {
      this.lastError = `process error: ${err.message}`;
      this.transition("errored");
    });
  }

  async stop(): Promise<void> {
    if (this.state === "stopped" || this.state === "errored") return;
    if (!this.child) {
      this.transition("stopped");
      return;
    }
    this.transition("stopping");
    const child = this.child;
    child.kill("SIGTERM");
    const stopped = await waitForExit(child, 5000);
    if (!stopped) {
      child.kill("SIGKILL");
      await waitForExit(child, 2000);
    }
  }

  // --- private helpers ---

  private transition(next: GatewayState): void {
    this.state = next;
    if (next === "stopped") {
      this.startedAt = null;
      this.listenAddr = null;
    }
    this.emitState();
  }

  private emitState(): void {
    this.opts.onStateChange(this.getStatus());
  }

  private readStoredPath(): string | null {
    try {
      const raw = fs.readFileSync(this.storagePath, "utf8").trim();
      if (!raw) return null;
      // Re-validate on every load: file may have been removed/upgraded.
      try {
        const stat = fs.statSync(raw);
        if (stat.isFile()) {
          const probe = spawnSync(raw, ["--version"], {
            timeout: 5000,
            encoding: "utf8",
            env: { PATH: CURATED_PATH },
            shell: false,
          });
          const combined = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
          const m = VERSION_REGEX.exec(combined);
          if (m) {
            this.binaryVersion = m[1];
            return raw;
          }
        }
      } catch {
        // fall through to null
      }
      return null;
    } catch {
      return null;
    }
  }

  private writeStoredPath(absPath: string): void {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(this.storagePath, absPath, "utf8");
    } catch (err) {
      process.stderr.write(
        `[gateway] failed to persist binary path: ${(err as Error).message}\n`,
      );
    }
  }
}

function parseLogLine(raw: string): LogLine {
  const ts = new Date().toISOString();
  // slog JSON shape: {"time":"...","level":"INFO","msg":"...", ...rest}
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const level = normalizeLevel(parsed["level"]);
      const msg = typeof parsed["msg"] === "string" ? parsed["msg"] : "";
      const time = typeof parsed["time"] === "string" ? parsed["time"] : ts;
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k !== "level" && k !== "msg" && k !== "time") fields[k] = v;
      }
      return { timestamp: time, level, msg, fields, raw };
    } catch {
      // fall through to plain-text path
    }
  }
  return { timestamp: ts, level: "info", msg: raw, fields: {}, raw };
}

function normalizeLevel(v: unknown): LogLine["level"] {
  const s = String(v ?? "").toLowerCase();
  if (s === "debug") return "debug";
  if (s === "warn" || s === "warning") return "warn";
  if (s === "error" || s === "err") return "error";
  return "info";
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.killed) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
