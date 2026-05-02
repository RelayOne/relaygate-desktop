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

    const targets = browser.targets();
    const pageTarget = targets.find((t) => t.type() === "page");
    if (!pageTarget) {
      throw new Error("No page target found in Electron");
    }
    const page = await pageTarget.page();
    if (!page) {
      throw new Error("Failed to obtain puppeteer Page");
    }

    await page.waitForFunction("document.readyState === 'complete'", {
      timeout: PAGE_READY_TIMEOUT_MS,
    });
    await page.waitForSelector("body", { timeout: PAGE_READY_TIMEOUT_MS });

    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    const url = page.url();

    if (!url.startsWith("https://app.relaygate.ai") && !url.startsWith("http://localhost")) {
      throw new Error(`Unexpected URL after load: ${url}`);
    }
    if (bodyText.length === 0) {
      throw new Error("Body text is empty — page failed to render");
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });

    const result = {
      ok: true,
      url,
      title,
      body_chars: bodyText.length,
      screenshot: screenshotPath,
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
