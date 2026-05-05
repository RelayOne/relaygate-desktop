import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GatewayController } from "../src/gateway/controller";
import { InMemoryBinaryPathStore } from "../src/gateway/storage";
import type { GatewayStatus, LogLine } from "../src/gateway/types";

// Unit-style integration test for GatewayController. Runs under tsx (no
// Electron). Validates:
//   - Binary path validation rejects non-existent files
//   - Binary path validation rejects binaries that don't print 'relaygate v<semver>'
//   - Binary path validation accepts a mock script that prints the expected version
//   - start() transitions stopped → starting → running once stderr is seen
//   - log lines are forwarded through onLog with structured JSON parsing
//   - listenAddr is extracted from the "relaygate listening" log line
//   - stop() returns process to "stopped"
//
// The mock binary lives at tests/fixtures/mock-relaygate.js. We invoke that
// file via different env-var setups to simulate version/error cases.

const FIXTURE_BIN = path.resolve(__dirname, "fixtures/mock-relaygate.js");
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-test-"));

interface ProbeResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: ProbeResult[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  results.push({ name, passed: cond, detail });
}

async function waitFor<T>(
  fn: () => T | undefined,
  timeoutMs: number,
  intervalMs: number = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// We need the mock binary to be on disk and executable. The fixture file is
// already written by the project; ensure the executable bit is set and that
// path.isAbsolute() picks it up.
fs.chmodSync(FIXTURE_BIN, 0o755);

async function main(): Promise<void> {
  // === Test 1: rejects non-existent path ===
  {
    const store = new InMemoryBinaryPathStore();
    const ctrl = new GatewayController(
      { onLog: () => {}, onStateChange: () => {} },
      store,
    );
    const result = ctrl.setBinaryPath(path.join(TMP_DIR, "does-not-exist"));
    check(
      "rejects non-existent path",
      !result.valid && (result.error ?? "").includes("stat failed"),
      JSON.stringify(result),
    );
  }

  // === Test 2: rejects binary that doesn't print expected version ===
  {
    const store = new InMemoryBinaryPathStore();
    const ctrl = new GatewayController(
      { onLog: () => {}, onStateChange: () => {} },
      store,
    );
    // The bad-version binary lives at tests/fixtures/bad-version-binary.js.
    // setBinaryPath's --version probe runs with a curated env (no shell), so
    // we use a separate fixture file rather than inlining the script content.
    const badShim = path.resolve(__dirname, "fixtures/bad-version-binary.js");
    fs.chmodSync(badShim, 0o755);
    const result = ctrl.setBinaryPath(badShim);
    check(
      "rejects bad version output",
      !result.valid && (result.error ?? "").includes("version not detected"),
      JSON.stringify(result),
    );
  }

  // === Test 3: accepts good mock binary, persists path ===
  {
    const store = new InMemoryBinaryPathStore();
    const ctrl = new GatewayController(
      { onLog: () => {}, onStateChange: () => {} },
      store,
    );
    const result = ctrl.setBinaryPath(FIXTURE_BIN);
    check(
      "accepts good binary",
      result.valid && result.version === "1.1.0",
      JSON.stringify(result),
    );
    check("persists path to store", store.read() === FIXTURE_BIN);
  }

  // === Test 4: start() transitions states + log lines flow + listenAddr extracted ===
  {
    const store = new InMemoryBinaryPathStore();
    const states: GatewayStatus[] = [];
    const logs: LogLine[] = [];
    const ctrl = new GatewayController(
      {
        onLog: (l) => logs.push(l),
        onStateChange: (s) => states.push(s),
      },
      store,
    );
    ctrl.setBinaryPath(FIXTURE_BIN);
    await ctrl.start();
    await waitFor(
      () => (states.find((s) => s.state === "running") ? true : undefined),
      5000,
    );
    const stateSequence = states.map((s) => s.state);
    check(
      "state sequence includes starting and running",
      stateSequence.includes("starting") && stateSequence.includes("running"),
      JSON.stringify(stateSequence),
    );

    await waitFor(() => (logs.length >= 1 ? true : undefined), 5000);
    const listeningLog = logs.find((l) => l.msg.includes("listening"));
    check(
      "structured log parsed (msg field present)",
      !!listeningLog,
      `logs=${JSON.stringify(logs.slice(0, 3))}`,
    );
    check(
      "listenAddr extracted from log",
      ctrl.getStatus().listenAddr === ":8090",
      `listenAddr=${ctrl.getStatus().listenAddr}`,
    );

    // Stop.
    await ctrl.stop();
    await waitFor(
      () =>
        states[states.length - 1]?.state === "stopped" ? true : undefined,
      8000,
    );
    check(
      "stop returns to stopped",
      states[states.length - 1].state === "stopped",
      JSON.stringify(states.map((s) => s.state)),
    );
  }

  // Cleanup
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  const allPassed = results.every((r) => r.passed);
  process.stdout.write(JSON.stringify({ ok: allPassed, results }, null, 2) + "\n");
  if (!allPassed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[gateway-test] FAIL:", err);
  process.exitCode = 1;
});
