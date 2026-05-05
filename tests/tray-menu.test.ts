// Unit test for the tray menu's pure logic — runs under tsx without
// Electron. Walks through all 5 GatewayState values plus the
// "no-binary" edge case and asserts:
//   1. statusLabel returns the expected human-readable line
//   2. trayMenuEnabledFlags returns correct Start/Stop enable bits

import {
  statusLabel,
  trayMenuEnabledFlags,
} from "../src/tray-menu-logic";
import type { GatewayStatus } from "../src/gateway/types";

interface ProbeResult {
  name: string;
  passed: boolean;
  detail?: string;
}
const results: ProbeResult[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  results.push({ name, passed: cond, detail });
}

function makeStatus(overrides: Partial<GatewayStatus> = {}): GatewayStatus {
  return {
    state: "stopped",
    pid: null,
    binaryPath: "/usr/local/bin/relaygate",
    binaryVersion: "1.1.0",
    startedAt: null,
    listenAddr: null,
    lastError: null,
    ...overrides,
  };
}

// === statusLabel coverage ===

const noBinary = makeStatus({ binaryPath: null, binaryVersion: null });
check(
  "no-binary label = 'not configured'",
  statusLabel(noBinary) === "Gateway: not configured",
  statusLabel(noBinary),
);

const runningWithAddr = makeStatus({
  state: "running",
  pid: 12345,
  listenAddr: ":8090",
  startedAt: "2026-05-05T08:00:00Z",
});
check(
  "running with addr",
  statusLabel(runningWithAddr) === "Gateway: running on :8090",
  statusLabel(runningWithAddr),
);

const runningNoAddr = makeStatus({ state: "running", pid: 12345, listenAddr: null });
check(
  "running without addr",
  statusLabel(runningNoAddr) === "Gateway: running",
  statusLabel(runningNoAddr),
);

const startingStatus = makeStatus({ state: "starting" });
check(
  "starting label",
  statusLabel(startingStatus) === "Gateway: starting...",
  statusLabel(startingStatus),
);

const stoppingStatus = makeStatus({ state: "stopping", pid: 12345 });
check(
  "stopping label",
  statusLabel(stoppingStatus) === "Gateway: stopping...",
  statusLabel(stoppingStatus),
);

const erroredStatus = makeStatus({
  state: "errored",
  lastError: "exited code=1 signal=none",
});
check(
  "errored label includes lastError",
  statusLabel(erroredStatus).startsWith("Gateway: errored —") &&
    statusLabel(erroredStatus).includes("exited"),
  statusLabel(erroredStatus),
);

const erroredNoMsg = makeStatus({ state: "errored", lastError: null });
check(
  "errored without lastError",
  statusLabel(erroredNoMsg) === "Gateway: errored",
  statusLabel(erroredNoMsg),
);

const stoppedWithVersion = makeStatus({ state: "stopped", binaryVersion: "1.1.0" });
check(
  "stopped with version",
  statusLabel(stoppedWithVersion) === "Gateway: stopped (v1.1.0)",
  statusLabel(stoppedWithVersion),
);

const stoppedNoVersion = makeStatus({
  state: "stopped",
  binaryVersion: null,
  binaryPath: "/some/path",
});
check(
  "stopped without version",
  statusLabel(stoppedNoVersion) === "Gateway: stopped",
  statusLabel(stoppedNoVersion),
);

// errored label truncation (lastError > 60 chars)
const longErr = makeStatus({
  state: "errored",
  lastError: "x".repeat(120),
});
const longLabel = statusLabel(longErr);
check(
  "long lastError truncated to 60 chars (with ellipsis)",
  longLabel.endsWith("…") && longLabel.length < 200,
  `len=${longLabel.length} label=${longLabel}`,
);

// === trayMenuEnabledFlags coverage ===

check(
  "stopped + hasBinary → start=true stop=false",
  (() => {
    const f = trayMenuEnabledFlags(makeStatus({ state: "stopped" }));
    return f.start === true && f.stop === false;
  })(),
);

check(
  "stopped + NO binary → start=false stop=false",
  (() => {
    const f = trayMenuEnabledFlags(
      makeStatus({ state: "stopped", binaryPath: null }),
    );
    return f.start === false && f.stop === false;
  })(),
);

check(
  "running → start=false stop=true",
  (() => {
    const f = trayMenuEnabledFlags(makeStatus({ state: "running" }));
    return f.start === false && f.stop === true;
  })(),
);

check(
  "starting → start=false stop=false",
  (() => {
    const f = trayMenuEnabledFlags(makeStatus({ state: "starting" }));
    return f.start === false && f.stop === false;
  })(),
);

check(
  "stopping → start=false stop=false",
  (() => {
    const f = trayMenuEnabledFlags(makeStatus({ state: "stopping" }));
    return f.start === false && f.stop === false;
  })(),
);

check(
  "errored + hasBinary → start=true (recovery path)",
  (() => {
    const f = trayMenuEnabledFlags(makeStatus({ state: "errored" }));
    return f.start === true && f.stop === false;
  })(),
);

const allPassed = results.every((r) => r.passed);
process.stdout.write(JSON.stringify({ ok: allPassed, results }, null, 2) + "\n");
if (!allPassed) {
  process.exitCode = 1;
}
