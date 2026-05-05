import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import puppeteer from "puppeteer-core";

const DEBUG_PORT = 9222;
const ARTIFACT_DIR = path.resolve(__dirname, "artifacts");
const ELECTRON_BIN = path.resolve(__dirname, "..", "node_modules", ".bin", "electron");
const APP_ENTRY = path.resolve(__dirname, "..");
const STARTUP_TIMEOUT_MS = 60_000;
const PAGE_READY_TIMEOUT_MS = 45_000;

// Mirror src/main.ts's env detection. Reads bundled package.json to get the
// embedded build env. Defaults to 'prod' on any error so locally-run smokes
// against an unbuilt source tree still target the prod dashboard.
type SmokeEnv = "prod" | "staging" | "dev";
const DASHBOARD_URL_BY_ENV: Record<SmokeEnv, string> = {
  prod: "https://app.relaygate.ai",
  staging: "https://app.staging.relaygate.ai",
  dev: "https://app.dev.relaygate.ai",
};
function readSmokeEnv(): SmokeEnv {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(APP_ENTRY, "package.json"), "utf8"),
    ) as { env?: string };
    if (pkg.env === "dev" || pkg.env === "staging") return pkg.env;
    return "prod";
  } catch {
    return "prod";
  }
}
const SMOKE_BUILD_ENV: SmokeEnv = readSmokeEnv();
const EXPECTED_DASHBOARD_URL = DASHBOARD_URL_BY_ENV[SMOKE_BUILD_ENV];
const EXPECTED_DASHBOARD_ORIGIN = new URL(EXPECTED_DASHBOARD_URL).origin;

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

async function main(): Promise<void> {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(ARTIFACT_DIR, `smoke-${stamp}.png`);
  const stderrLogPath = path.join(ARTIFACT_DIR, `smoke-${stamp}.stderr.log`);
  const stdoutLogPath = path.join(ARTIFACT_DIR, `smoke-${stamp}.stdout.log`);

  if (!fs.existsSync(ELECTRON_BIN)) {
    throw new Error(`Electron binary not found at ${ELECTRON_BIN}; run \`npm install\` first`);
  }

  const electronArgs = [
    APP_ENTRY,
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--no-sandbox",
  ];

  const child: ChildProcess = spawn(ELECTRON_BIN, electronArgs, {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutStream = fs.createWriteStream(stdoutLogPath);
  const stderrStream = fs.createWriteStream(stderrLogPath);
  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(stderrStream);

  let exited = false;
  child.on("exit", (code, signal) => {
    exited = true;
    console.error(`[smoke] electron exited code=${code} signal=${signal}`);
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

    // Attach response listener to ALL targets BEFORE waiting on any specific
    // target, so a fast initial document response can't slip past unobserved.
    let mainResponseStatus = -1;
    let recordedDocUrl = "";
    browser.on("targetcreated", async (t) => {
      if (t.type() !== "page") return;
      const p = await t.page().catch(() => null);
      if (!p) return;
      p.on("response", (resp) => {
        if (mainResponseStatus >= 0) return;
        if (resp.frame() !== p.mainFrame()) return;
        if (resp.request().resourceType() !== "document") return;
        const u = resp.url();
        if (
          !u.startsWith(EXPECTED_DASHBOARD_ORIGIN) &&
          !u.startsWith("http://localhost")
        ) {
          return;
        }
        mainResponseStatus = resp.status();
        recordedDocUrl = u;
      });
    });

    // Cover the case where the page target was already created before this
    // listener attached (race window between connect() and on()).
    for (const t of browser.targets()) {
      if (t.type() !== "page") continue;
      const p = await t.page().catch(() => null);
      if (!p) continue;
      p.on("response", (resp) => {
        if (mainResponseStatus >= 0) return;
        if (resp.frame() !== p.mainFrame()) return;
        if (resp.request().resourceType() !== "document") return;
        const u = resp.url();
        if (
          !u.startsWith(EXPECTED_DASHBOARD_ORIGIN) &&
          !u.startsWith("http://localhost")
        ) {
          return;
        }
        mainResponseStatus = resp.status();
        recordedDocUrl = u;
      });
    }

    const dashboardTarget = await browser.waitForTarget(
      (t) =>
        t.type() === "page" &&
        (t.url().startsWith(EXPECTED_DASHBOARD_ORIGIN) ||
          t.url().startsWith("http://localhost")),
      { timeout: PAGE_READY_TIMEOUT_MS },
    );
    const initialUrl = dashboardTarget.url();
    const page = await dashboardTarget.page();
    if (!page) {
      throw new Error("Failed to obtain puppeteer Page from dashboard target");
    }

    try {
      await page.waitForFunction(() => document.readyState === "complete", {
        timeout: PAGE_READY_TIMEOUT_MS,
      });
      await page.waitForSelector("body", { timeout: PAGE_READY_TIMEOUT_MS });
    } catch (waitErr) {
      process.stderr.write(`[smoke] readyState wait failed: ${(waitErr as Error).message}\n`);
    }

    let screenshotOk = false;
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshotOk = true;
    } catch (shotErr) {
      process.stderr.write(`[smoke] screenshot failed: ${(shotErr as Error).message}\n`);
    }

    const title = await page.title().catch(() => "<title-fetch-failed>");
    const bodyText = await page
      .evaluate(() => document.body?.innerText?.trim() ?? "")
      .catch(() => "<evaluate-failed>");
    const finalUrl = page.url();

    const expectedOrigin = EXPECTED_DASHBOARD_ORIGIN;
    const allowedFinalOrigin = (() => {
      try {
        return new URL(finalUrl).origin === expectedOrigin;
      } catch {
        return false;
      }
    })();
    const titleMatchesProduct =
      typeof title === "string" && title.toLowerCase().includes("relaygate");
    const bodyMentionsSignIn =
      typeof bodyText === "string" &&
      bodyText.toLowerCase().indexOf("sign in") >= 0;
    const bodyMinChars =
      typeof bodyText === "string" && bodyText.length >= 60;

    // If we missed the main-frame response (rare but possible when Electron's
    // page is created before puppeteer.connect()), fall back to a HEAD probe
    // against the final URL. This keeps the assertion meaningful while
    // avoiding the regression flagged in Round 3 review.
    if (mainResponseStatus < 0) {
      try {
        const probe = await fetch(finalUrl, { method: "GET", redirect: "follow" });
        mainResponseStatus = probe.status;
        recordedDocUrl = `fallback-fetch:${finalUrl}`;
      } catch (probeErr) {
        process.stderr.write(
          `[smoke] HTTP status fallback fetch failed: ${(probeErr as Error).message}\n`,
        );
      }
    }
    const httpStatusOk = mainResponseStatus >= 200 && mainResponseStatus < 400;

    const passed =
      initialUrl.startsWith(expectedOrigin) &&
      allowedFinalOrigin &&
      titleMatchesProduct &&
      bodyMentionsSignIn &&
      bodyMinChars &&
      screenshotOk &&
      httpStatusOk;

    const result = {
      ok: passed,
      initial_url: initialUrl,
      final_url: finalUrl,
      title,
      body_chars: typeof bodyText === "string" ? bodyText.length : -1,
      http_status: mainResponseStatus,
      http_status_source: recordedDocUrl,
      screenshot: screenshotOk ? screenshotPath : null,
      stdout_log: stdoutLogPath,
      stderr_log: stderrLogPath,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, `smoke-${stamp}.result.json`),
      JSON.stringify(result, null, 2),
    );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");

    await browser.disconnect();

    if (!passed) {
      throw new Error(
        `Smoke assertions failed: initial_url=${initialUrl} final_url=${finalUrl} body_chars=${
          typeof bodyText === "string" ? bodyText.length : -1
        } screenshot_ok=${screenshotOk}`,
      );
    }
  } finally {
    if (!exited) {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!exited) {
        child.kill("SIGKILL");
      }
    }
  }
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exitCode = 1;
});
