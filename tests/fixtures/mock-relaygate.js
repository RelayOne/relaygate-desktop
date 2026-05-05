#!/usr/bin/env node
// Mock relaygate binary for tests/gateway.test.ts. Generated dynamically per
// test case via the GATEWAY_MOCK_* env vars below. Not a test file — it's
// the *binary under test* that GatewayController spawns.
//
// Env vars (read at startup):
//   GATEWAY_MOCK_VERSION_LINE    — the line emitted on stderr when --version is passed
//                                   (default: "relaygate v1.1.0")
//   GATEWAY_MOCK_LOG_LINES_JSON  — JSON array of stderr log lines emitted on normal run
//                                   (default: a "relaygate listening" line + "ready")
//   GATEWAY_MOCK_EXIT_DELAY_MS   — milliseconds the mock sleeps after emitting all
//                                   log lines before voluntarily exiting (default 60000)

if (process.argv.includes("--version")) {
  const v = process.env.GATEWAY_MOCK_VERSION_LINE || "relaygate v1.1.0";
  process.stderr.write(v + "\n");
  process.exit(0);
}

const linesJson =
  process.env.GATEWAY_MOCK_LOG_LINES_JSON ||
  JSON.stringify([
    '{"time":"2026-05-05T08:00:00Z","level":"INFO","msg":"relaygate listening","addr":":8090","version":"v1.1.0"}',
    '{"time":"2026-05-05T08:00:01Z","level":"INFO","msg":"ready"}',
  ]);
const lines = JSON.parse(linesJson);
const exitDelay = parseInt(process.env.GATEWAY_MOCK_EXIT_DELAY_MS || "60000", 10);

let i = 0;
const emit = () => {
  if (i >= lines.length) {
    setTimeout(() => process.exit(0), exitDelay);
    return;
  }
  process.stderr.write(lines[i] + "\n");
  i++;
  setTimeout(emit, 50);
};
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
emit();
