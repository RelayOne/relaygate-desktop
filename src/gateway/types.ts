// Public type contract for the gateway controller. Imported by
// src/main.ts (IPC wiring), src/preload.ts (bridge), src/gateway/controller.ts,
// src/gateway/storage.ts, and the test harnesses.
//
// Design constraint: this file MUST NOT import anything from electron, so the
// controller logic stays unit-testable from a plain Node entrypoint.

export type GatewayState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "errored";

export interface GatewayStatus {
  state: GatewayState;
  pid: number | null;
  binaryPath: string | null;
  binaryVersion: string | null;
  startedAt: string | null; // ISO 8601 timestamp
  listenAddr: string | null; // parsed from log line "relaygate listening addr=..."
  lastError: string | null;
}

export interface LogLine {
  timestamp: string; // ISO 8601
  level: "info" | "warn" | "error" | "debug";
  msg: string;
  fields: Record<string, unknown>; // parsed JSON keys minus level/msg/time
  raw: string; // original line as emitted by the subprocess
}

export interface BinaryValidation {
  valid: boolean;
  version: string | null;
  error: string | null;
}

export interface GatewayControllerOpts {
  onLog: (line: LogLine) => void;
  onStateChange: (status: GatewayStatus) => void;
  // Optional override for the user-data directory (used in tests so we don't
  // collide with a real desktop install's stored binary path).
  userDataDirOverride?: string;
}
