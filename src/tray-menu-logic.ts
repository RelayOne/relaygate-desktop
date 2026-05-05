// Pure logic for the tray menu — no Electron imports so tests/tray-menu.test.ts
// can run under tsx without an Electron runtime.

import type { GatewayStatus } from "./gateway/types";

export function truncateForLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function statusLabel(status: GatewayStatus): string {
  if (!status.binaryPath) return "Gateway: not configured";
  switch (status.state) {
    case "running":
      return status.listenAddr
        ? `Gateway: running on ${status.listenAddr}`
        : "Gateway: running";
    case "starting":
      return "Gateway: starting...";
    case "stopping":
      return "Gateway: stopping...";
    case "errored":
      return status.lastError
        ? `Gateway: errored — ${truncateForLabel(status.lastError, 60)}`
        : "Gateway: errored";
    case "stopped":
    default:
      return status.binaryVersion
        ? `Gateway: stopped (v${status.binaryVersion})`
        : "Gateway: stopped";
  }
}

export function trayMenuEnabledFlags(status: GatewayStatus): {
  start: boolean;
  stop: boolean;
} {
  const isStopped = status.state === "stopped" || status.state === "errored";
  const isRunning = status.state === "running";
  const hasBinary = !!status.binaryPath;
  return { start: isStopped && hasBinary, stop: isRunning };
}
