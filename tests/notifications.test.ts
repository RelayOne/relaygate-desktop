import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import puppeteer from "puppeteer-core";

// Smoke test for the setPermissionRequestHandler allowlist installed in
// src/main.ts. Asserts:
//   1. A page loaded from a non-allowlisted origin (here, app.relaygate.ai
//      with the URL temporarily pointed at a data: URL via the env var) gets
//      `denied` when it calls Notification.requestPermission().
//   2. A page loaded from an allowlisted origin (app.relaygate.ai default)
//      gets `granted`.
//
// We do NOT assert that an OS-level toast renders. Toast rendering depends on
// whether libnotify / dbus / GNOME-Shell are present, which varies wildly in
// CI. The handler's allow/deny decision is the actual contract this spec ships.

const DEBUG_PORT = 9223;
const ARTIFACT_DIR = path.resolve(__dirname, "artifacts");
const ELECTRON_BIN = path.resolve(__dirname, "..", "node_modules", ".bin", "electron");
const APP_ENTRY = path.resolve(__dirname, "..");
const STARTUP_TIMEOUT_MS = 60_000;
const PAGE_READY_TIMEOUT_MS = 30_000;

// Both cases use a `data:` URL as the rendered document. The difference is
// where we tell the wrapper the dashboard "lives" via RELAYGATE_DESKTOP_URL.
// data: URLs always have an opaque origin, so they are NEVER in our allowlist
// regardless of what the wrapper thinks the dashboard origin is. That gives
// us the deny case for free.
//
// For the "granted" case, we need a renderer that runs from an allowlisted
// origin. The cleanest way without standing up a server is to point
// RELAYGATE_DESKTOP_URL at a known allowlisted host (the dashboard itself);
// the page will load NextAuth and we run our `Notification.requestPermission()`
// probe via DevTools Protocol's Page.addScriptToEvaluateOnNewDocument so the
// script runs before the dashboard's own JS.

const PROBE_SCRIPT = `
  (async () => {
    try {
      const result = await Notification.requestPermission();
      document.title = "PROBE_RESULT:" + result;
    } catch (err) {
      document.title = "PROBE_RESULT:error:" + err.message;
    }
  })();
`;

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = (): void => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Port ${port} did not open within ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 250);
        }
      });
    };
    tryConnect();
  });
}

interface ProbeResult {
  scenario: string;
  origin: string;
  permission: string;
  passed: boolean;
}

async function runProbe(scenario: string, dashboardUrl: string, expected: "granted" | "denied"): Promise<ProbeResult> {
  const electronArgs = [
    APP_ENTRY,
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--no-sandbox",
  ];
  const child: ChildProcess = spawn(ELECTRON_BIN, electronArgs, {
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      RELAYGATE_DESKTOP_URL: dashboardUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let exited = false;
  child.on("exit", (code, signal) => {
    exited = true;
    process.stderr.write(`[notifications] electron exited code=${code} signal=${signal}\n`);
  });

  try {
    await waitForPort(DEBUG_PORT, STARTUP_TIMEOUT_MS);
    if (exited) {
      throw new Error("Electron exited before debug port opened");
    }

    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
      defaultViewport: null,
    });

    const target = await browser.waitForTarget(
      (t) => t.type() === "page",
      { timeout: PAGE_READY_TIMEOUT_MS },
    );
    const page = await target.page();
    if (!page) throw new Error("No page from target");

    // Inject probe BEFORE running. This races the dashboard JS but only needs
    // to call Notification.requestPermission() once — first call wins.
    await page.evaluate(PROBE_SCRIPT);

    // Poll document.title for "PROBE_RESULT:..." up to 10s.
    const deadline = Date.now() + 10_000;
    let titleResult = "";
    while (Date.now() < deadline) {
      titleResult = await page.title();
      if (titleResult.startsWith("PROBE_RESULT:")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const permission = titleResult.replace(/^PROBE_RESULT:/, "");
    const origin = (() => {
      try {
        return new URL(dashboardUrl).origin;
      } catch {
        return dashboardUrl;
      }
    })();
    const passed = permission === expected;
    await browser.disconnect();
    return { scenario, origin, permission, passed };
  } finally {
    if (!exited) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1000));
      if (!exited) child.kill("SIGKILL");
    }
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const results: ProbeResult[] = [];

  // Case 1: data: URL — opaque origin, never in allowlist → must be denied.
  const dataUrl =
    "data:text/html,<title>loading</title><body>not-allowlisted</body>";
  results.push(await runProbe("non_allowlisted_data_url", dataUrl, "denied"));

  // Case 2: app.relaygate.ai — in EXTERNAL_ORIGIN_ALLOWLIST → must be granted.
  results.push(
    await runProbe("allowlisted_app_relaygate_ai", "https://app.relaygate.ai", "granted"),
  );

  const allPassed = results.every((r) => r.passed);
  const summary = {
    ok: allPassed,
    results,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, `notifications-${stamp}.result.json`),
    JSON.stringify(summary, null, 2),
  );
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");

  if (!allPassed) {
    throw new Error(
      `Permission probe assertions failed: ${JSON.stringify(results)}`,
    );
  }
}

main().catch((err) => {
  console.error("[notifications] FAIL:", err);
  process.exitCode = 1;
});
