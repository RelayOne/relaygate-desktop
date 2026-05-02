import { app, BrowserWindow, Menu, shell } from "electron";
import * as path from "node:path";

const DEFAULT_DASHBOARD_URL = "https://app.relaygate.ai";

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
      `[main] RELAYGATE_DESKTOP_URL=${raw} invalid (${(err as Error).message}); ` +
        `falling back to ${DEFAULT_DASHBOARD_URL}\n`,
    );
    const fallback = new URL(DEFAULT_DASHBOARD_URL);
    return { href: fallback.toString(), origin: fallback.origin };
  }
}

const { href: DASHBOARD_URL, origin: DASHBOARD_ORIGIN } = resolveDashboardUrl();

const EXTERNAL_LINK_ALLOWLIST: ReadonlySet<string> = new Set([
  "https://relaygate.ai",
  "https://app.relaygate.ai",
  "https://docs.relaygate.ai",
  "https://github.com",
  "https://www.github.com",
  "https://accounts.google.com",
  "https://stripe.com",
  "https://billing.stripe.com",
]);

function isAllowedExternalOrigin(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return EXTERNAL_LINK_ALLOWLIST.has(u.origin);
  } catch {
    return false;
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalOrigin(url)) {
      void shell.openExternal(url);
    } else {
      process.stderr.write(`[main] window-open denied for ${url}\n`);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      event.preventDefault();
      process.stderr.write(`[main] will-navigate denied (unparseable URL): ${url}\n`);
      return;
    }
    if (target.origin !== DASHBOARD_ORIGIN) {
      event.preventDefault();
      if (isAllowedExternalOrigin(url)) {
        void shell.openExternal(url);
      } else {
        process.stderr.write(`[main] will-navigate denied off-allowlist: ${url}\n`);
      }
    }
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    process.stderr.write(
      `[main] did-fail-load url=${validatedURL} code=${errorCode} desc=${errorDescription}\n`,
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

void app.whenReady().then(() => {
  buildAppMenu();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
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
