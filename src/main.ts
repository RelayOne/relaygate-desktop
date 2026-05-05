import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, session, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

import { GatewayController } from "./gateway/controller";
import { SafeStorageBinaryPathStore } from "./gateway/storage";
import { createTray } from "./tray";
import type { GatewayStatus } from "./gateway/types";

type BuildEnv = "prod" | "staging" | "dev";

const DEFAULT_DASHBOARD_URL_BY_ENV: Record<BuildEnv, string> = {
  prod: "https://app.relaygate.ai",
  staging: "https://app.staging.relaygate.ai",
  dev: "https://app.dev.relaygate.ai",
};

// Read the build env that electron-builder embedded via
// --config.extraMetadata.env (see cloudbuild.yaml dist-all-platforms step).
// `__dirname` resolves to `<bundle>/dist/`; package.json sits one level up
// in both dev and packaged-asar layouts. Default to "prod" on any error so
// older binaries built before this field existed still work.
function readBuildEnv(): BuildEnv {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { env?: string };
    if (pkg.env === "dev" || pkg.env === "staging") return pkg.env;
    return "prod";
  } catch {
    return "prod";
  }
}

const BUILD_ENV: BuildEnv = readBuildEnv();
const DEFAULT_DASHBOARD_URL = DEFAULT_DASHBOARD_URL_BY_ENV[BUILD_ENV];

function resolveDashboardUrl(): { href: string; origin: string } {
  const raw = process.env.RELAYGATE_DESKTOP_URL ?? DEFAULT_DASHBOARD_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Disallowed protocol: ${parsed.protocol}`);
    }
    return { href: parsed.toString(), origin: parsed.origin };
  } catch (err) {
    process.stderr.write(
      `[main] RELAYGATE_DESKTOP_URL invalid (${(err as Error).message}); ` +
        `falling back to ${DEFAULT_DASHBOARD_URL}\n`,
    );
    const fallback = new URL(DEFAULT_DASHBOARD_URL);
    return { href: fallback.toString(), origin: fallback.origin };
  }
}

const { href: DASHBOARD_URL, origin: DASHBOARD_ORIGIN } = resolveDashboardUrl();

// Exact origins (https-only).
const EXTERNAL_ORIGIN_ALLOWLIST: ReadonlySet<string> = new Set([
  "https://relaygate.ai",
  "https://www.relaygate.ai",
  "https://app.relaygate.ai",
  "https://app.staging.relaygate.ai",
  "https://app.dev.relaygate.ai",
  "https://docs.relaygate.ai",
  "https://blog.relaygate.ai",
  "https://api.relaygate.ai",
  "https://github.com",
  "https://www.github.com",
  "https://accounts.google.com",
  "https://stripe.com",
  "https://billing.stripe.com",
  "https://checkout.stripe.com",
  "https://js.stripe.com",
  "https://m.stripe.com",
  "https://m.stripe.network",
  "https://relayone.ai",
  "https://app.relayone.ai",
]);

// Suffix matching for first-party subdomains (https-only).
const ALLOWED_HOST_SUFFIXES: readonly string[] = [
  ".relaygate.ai",
  ".relayone.ai",
  ".stripe.com",
  ".googleusercontent.com",
];

function isAllowedExternalOrigin(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    if (EXTERNAL_ORIGIN_ALLOWLIST.has(u.origin)) return true;
    for (const suffix of ALLOWED_HOST_SUFFIXES) {
      if (u.hostname === suffix.slice(1) || u.hostname.endsWith(suffix)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function safeUrlForLog(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "<unparseable-url>";
  }
}

function safeOriginOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: "RelayGate",
    backgroundColor: "#0b0b0d",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    show: false,
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  // On Windows + Linux WITH a live tray, intercept the close button to hide
  // the window rather than quit the app. macOS uses its own conventional
  // hide-on-close pattern via `window-all-closed`. If the tray failed to
  // construct (Linux without StatusNotifierItem), the default quit-on-close
  // applies — otherwise the user couldn't kill the app.
  win.on("close", (event) => {
    if (process.platform === "darwin") return;
    if (isQuitting) return;
    if (!tray) return; // No tray → default quit-on-close stays
    event.preventDefault();
    win.hide();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalOrigin(url)) {
      void shell.openExternal(url);
    } else {
      process.stderr.write(`[main] window-open denied for ${safeUrlForLog(url)}\n`);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      event.preventDefault();
      process.stderr.write(`[main] will-navigate denied (unparseable URL)\n`);
      return;
    }
    if (target.origin !== DASHBOARD_ORIGIN) {
      event.preventDefault();
      if (isAllowedExternalOrigin(url)) {
        void shell.openExternal(url);
      } else {
        process.stderr.write(
          `[main] will-navigate denied off-allowlist: ${safeUrlForLog(url)}\n`,
        );
      }
    }
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    process.stderr.write(
      `[main] did-fail-load url=${safeUrlForLog(validatedURL)} code=${errorCode} desc=${errorDescription}\n`,
    );
  });

  void win.loadURL(DASHBOARD_URL);
  return win;
}

function buildAppMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open RelayGate Website",
          click: () => {
            void shell.openExternal("https://relaygate.ai");
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Lazy-init: GatewayController + IPC handlers depend on app.whenReady() so
// safeStorage and app.getPath("userData") are usable. Kept module-level so
// before-quit can reference it.
let gateway: GatewayController | null = null;
// Tray reference must outlive its constructor — V8 will GC it otherwise and
// the icon disappears from the system tray. Also `null` on platforms that
// reject tray construction (some headless Linux), in which case
// window-close-hides behavior is skipped (otherwise the app would be
// unkillable through the X button).
let tray: Tray | null = null;
let isQuitting = false;

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

void app.whenReady().then(() => {
  // Windows: associate native notifications + taskbar pinning with the
  // installed AppUserModelID (matches `appId` in electron-builder.yml). Without
  // this, Windows attributes notification toasts to "Electron" rather than
  // "RelayGate". No-op on macOS and Linux per Electron docs.
  app.setAppUserModelId("ai.relaygate.desktop");

  // Permission request handler: deny ALL renderer-initiated permissions by
  // default; only allow `notifications` for origins in our existing
  // EXTERNAL_ORIGIN_ALLOWLIST / ALLOWED_HOST_SUFFIXES. Must be installed
  // BEFORE the first BrowserWindow is created so the handler is in place
  // when the dashboard JS first calls Notification.requestPermission().
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission !== "notifications") {
        callback(false);
        return;
      }
      const requestingOrigin = details.requestingUrl
        ? safeOriginOf(details.requestingUrl)
        : null;
      if (requestingOrigin && isAllowedExternalOrigin(requestingOrigin)) {
        callback(true);
        return;
      }
      process.stderr.write(
        `[main] notification permission denied for ${requestingOrigin ?? "<unknown>"}\n`,
      );
      callback(false);
    },
  );

  // Instantiate gateway controller before the first window so the dashboard's
  // first calls into window.relaygate.gateway.* find live IPC handlers.
  gateway = new GatewayController(
    {
      onLog: (line) => getMainWindow()?.webContents.send("gateway:log", line),
      onStateChange: (s: GatewayStatus) => {
        getMainWindow()?.webContents.send("gateway:state", s);
        // Refresh tray menu on every gateway state transition so Start/Stop
        // enabled-state and the "Gateway: <state>" label stay current.
        const refreshHook = (
          tray as (Tray & { __refreshFromStatus?: (s: GatewayStatus) => void }) | null
        )?.__refreshFromStatus;
        refreshHook?.(s);
      },
    },
    new SafeStorageBinaryPathStore(app.getPath("userData")),
  );

  ipcMain.handle("gateway:start", (_e, configPath?: string) =>
    gateway!.start(configPath),
  );
  ipcMain.handle("gateway:stop", () => gateway!.stop());
  ipcMain.handle("gateway:status", () => gateway!.getStatus());
  ipcMain.handle("gateway:setBinaryPath", (_e, absPath: string) =>
    gateway!.setBinaryPath(absPath),
  );
  ipcMain.handle("gateway:getBinaryPath", () => gateway!.getBinaryPath());
  ipcMain.handle("gateway:pickBinary", async () => {
    const win = getMainWindow();
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ["openFile"],
          title: "Select relaygate binary",
        })
      : await dialog.showOpenDialog({
          properties: ["openFile"],
          title: "Select relaygate binary",
        });
    if (result.canceled || !result.filePaths[0]) return null;
    return gateway!.setBinaryPath(result.filePaths[0]);
  });

  buildAppMenu();
  createMainWindow();

  // Create tray AFTER first window so getMainWindow() in tray click handlers
  // resolves to a real window. Returns null when tray construction fails
  // (e.g. Linux without StatusNotifierItem support) — close-window-hides
  // behavior below checks for null and falls back to default quit.
  tray = createTray({
    gateway: gateway!,
    mainWindow: () => getMainWindow(),
    quit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", async (event) => {
  isQuitting = true;
  // Tear down tray first so its handlers don't fire mid-quit.
  if (tray) {
    try {
      tray.destroy();
    } catch {
      // best effort — platform-handle release; ignore failures during quit
    }
    tray = null;
  }
  if (!gateway) return;
  const status = gateway.getStatus();
  if (status.state === "running" || status.state === "starting") {
    event.preventDefault();
    try {
      // Race the stop against a 6s ceiling so a hung gateway never blocks
      // quitting indefinitely. Force-quit after the await regardless.
      const stopPromise = gateway.stop();
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, 6000),
      );
      await Promise.race([stopPromise, timeout]);
    } finally {
      gateway = null;
      app.quit();
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
});
