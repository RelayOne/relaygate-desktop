import * as fs from "node:fs";
import * as path from "node:path";
import puppeteer, { Browser, Page } from "puppeteer-core";

const CHROME_BIN = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const APP_BASE = process.env.RELAYGATE_LIVE_URL ?? "https://app.relaygate.ai";
const SITE_BASE = process.env.RELAYGATE_SITE_URL ?? "https://relaygate.ai";
const CI_TOKEN = process.env.CI_AUTH_TOKEN ?? "";

const ARTIFACT_DIR = path.resolve(__dirname, "artifacts", "live");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

interface FlowResult {
  flow: string;
  ok: boolean;
  url?: string;
  title?: string;
  body_chars?: number;
  status?: number;
  screenshot?: string;
  details?: string;
  error?: string;
}

const results: FlowResult[] = [];

function record(r: FlowResult): void {
  results.push(r);
  process.stdout.write(JSON.stringify(r) + "\n");
}

async function withPage<T>(
  browser: Browser,
  viewport: { width: number; height: number; isMobile?: boolean },
  fn: (p: Page) => Promise<T>,
): Promise<T> {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function flowSignInRender(browser: Browser): Promise<void> {
  const flow = "sign-in-page-render";
  try {
    await withPage(browser, { width: 1440, height: 900 }, async (page) => {
      const resp = await page.goto(`${APP_BASE}/sign-in`, {
        waitUntil: "networkidle2",
        timeout: 45_000,
      });
      const status = resp?.status() ?? 0;
      await page.waitForSelector("body", { timeout: 30_000 });
      const title = await page.title();
      const bodyText = await page.evaluate(() =>
        document.body.innerText.trim().slice(0, 4000),
      );
      const screenshot = path.join(ARTIFACT_DIR, `${STAMP}-sign-in.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      record({
        flow,
        ok:
          status === 200 &&
          bodyText.match(/Sign\s*in/i) !== null &&
          title.match(/RelayGate/i) !== null,
        url: page.url(),
        title,
        status,
        body_chars: bodyText.length,
        screenshot,
        details: bodyText.slice(0, 200),
      });
    });
  } catch (e) {
    record({ flow, ok: false, error: (e as Error).message });
  }
}

async function flowSignUpRender(browser: Browser): Promise<void> {
  const flow = "sign-up-page-render";
  try {
    await withPage(browser, { width: 1440, height: 900 }, async (page) => {
      const resp = await page.goto(`${APP_BASE}/sign-up`, {
        waitUntil: "networkidle2",
        timeout: 45_000,
      });
      const status = resp?.status() ?? 0;
      await page.waitForSelector("body", { timeout: 30_000 });
      const title = await page.title();
      const bodyText = await page.evaluate(() =>
        document.body.innerText.trim().slice(0, 4000),
      );
      const hasEmailField = await page.$("input[type=email], input[name=email]");
      const hasPasswordField = await page.$(
        "input[type=password], input[name=password]",
      );
      const screenshot = path.join(ARTIFACT_DIR, `${STAMP}-sign-up.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      record({
        flow,
        ok:
          status === 200 &&
          hasEmailField !== null &&
          hasPasswordField !== null &&
          bodyText.match(/Sign\s*up|Create|Register/i) !== null,
        url: page.url(),
        title,
        status,
        body_chars: bodyText.length,
        screenshot,
        details: `email_field=${hasEmailField !== null} password_field=${
          hasPasswordField !== null
        }`,
      });
    });
  } catch (e) {
    record({ flow, ok: false, error: (e as Error).message });
  }
}

async function flowCiSessionLogin(browser: Browser): Promise<void> {
  const flow = "ci-session-login-and-dashboard";
  if (!CI_TOKEN) {
    record({ flow, ok: false, error: "CI_AUTH_TOKEN env var not set" });
    return;
  }
  try {
    const resp = await fetch(`${APP_BASE}/api/auth/ci-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CI_TOKEN}`,
      },
      body: JSON.stringify({ email: "ci-puppeteer@example.com" }),
    });
    if (resp.status !== 200) {
      const txt = await resp.text();
      record({
        flow,
        ok: false,
        status: resp.status,
        error: `ci-session POST failed: ${txt.slice(0, 200)}`,
      });
      return;
    }
    const sessionData = (await resp.json()) as {
      session_cookie_name: string;
      session_cookie_value: string;
      expires_at: string;
      email: string;
    };

    await withPage(browser, { width: 1440, height: 900 }, async (page) => {
      const url = new URL(APP_BASE);
      await page.setCookie({
        name: sessionData.session_cookie_name,
        value: sessionData.session_cookie_value,
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      });
      const r = await page.goto(`${APP_BASE}/dashboard`, {
        waitUntil: "networkidle2",
        timeout: 45_000,
      });
      const status = r?.status() ?? 0;
      await page.waitForSelector("body", { timeout: 30_000 });
      const title = await page.title();
      const bodyText = await page.evaluate(() =>
        document.body.innerText.trim().slice(0, 4000),
      );
      const finalUrl = page.url();
      const screenshot = path.join(ARTIFACT_DIR, `${STAMP}-dashboard.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      record({
        flow,
        ok:
          status === 200 &&
          finalUrl.includes("/dashboard") &&
          bodyText.length > 30,
        url: finalUrl,
        title,
        status,
        body_chars: bodyText.length,
        screenshot,
        details: `email=${sessionData.email} cookie=${sessionData.session_cookie_name}`,
      });
    });
  } catch (e) {
    record({ flow, ok: false, error: (e as Error).message });
  }
}

async function flowDashboardMobile(browser: Browser): Promise<void> {
  const flow = "dashboard-mobile-iphone-12-pro";
  if (!CI_TOKEN) {
    record({ flow, ok: false, error: "CI_AUTH_TOKEN env var not set" });
    return;
  }
  try {
    const resp = await fetch(`${APP_BASE}/api/auth/ci-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CI_TOKEN}`,
      },
      body: JSON.stringify({ email: "ci-mobile@example.com" }),
    });
    if (resp.status !== 200) {
      record({
        flow,
        ok: false,
        status: resp.status,
        error: `ci-session POST failed`,
      });
      return;
    }
    const sessionData = (await resp.json()) as {
      session_cookie_name: string;
      session_cookie_value: string;
    };

    await withPage(
      browser,
      { width: 390, height: 844, isMobile: true },
      async (page) => {
        const url = new URL(APP_BASE);
        await page.setCookie({
          name: sessionData.session_cookie_name,
          value: sessionData.session_cookie_value,
          domain: url.hostname,
          path: "/",
          httpOnly: true,
          secure: true,
        });
        await page.setUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        );
        const r = await page.goto(`${APP_BASE}/dashboard`, {
          waitUntil: "networkidle2",
          timeout: 45_000,
        });
        const status = r?.status() ?? 0;
        await page.waitForSelector("body", { timeout: 30_000 });
        const screenshot = path.join(
          ARTIFACT_DIR,
          `${STAMP}-dashboard-mobile-390x844.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: true });
        const bodyText = await page.evaluate(() =>
          document.body.innerText.trim().slice(0, 2000),
        );
        record({
          flow,
          ok: status === 200 && bodyText.length > 20,
          url: page.url(),
          status,
          body_chars: bodyText.length,
          screenshot,
          details: "viewport 390x844 iPhone 12 Pro UA",
        });
      },
    );
  } catch (e) {
    record({ flow, ok: false, error: (e as Error).message });
  }
}

async function flowMarketingHomeMobile(browser: Browser): Promise<void> {
  const flow = "marketing-home-mobile";
  try {
    await withPage(
      browser,
      { width: 390, height: 844, isMobile: true },
      async (page) => {
        await page.setUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        );
        const r = await page.goto(SITE_BASE, {
          waitUntil: "networkidle2",
          timeout: 45_000,
        });
        const status = r?.status() ?? 0;
        await page.waitForSelector("body", { timeout: 30_000 });
        const title = await page.title();
        const bodyText = await page.evaluate(() =>
          document.body.innerText.trim().slice(0, 2000),
        );
        const screenshot = path.join(
          ARTIFACT_DIR,
          `${STAMP}-marketing-mobile-390x844.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: true });
        record({
          flow,
          ok: status === 200 && bodyText.match(/RelayGate/i) !== null,
          url: page.url(),
          title,
          status,
          body_chars: bodyText.length,
          screenshot,
        });
      },
    );
  } catch (e) {
    record({ flow, ok: false, error: (e as Error).message });
  }
}

async function flowMarketingHomeDesktop(browser: Browser): Promise<void> {
  const flow = "marketing-home-desktop";
  try {
    await withPage(browser, { width: 1440, height: 900 }, async (page) => {
      const r = await page.goto(SITE_BASE, {
        waitUntil: "networkidle2",
        timeout: 45_000,
      });
      const status = r?.status() ?? 0;
      await page.waitForSelector("body", { timeout: 30_000 });
      const title = await page.title();
      const bodyText = await page.evaluate(() =>
        document.body.innerText.trim().slice(0, 2000),
      );
      const screenshot = path.join(
        ARTIFACT_DIR,
        `${STAMP}-marketing-desktop-1440x900.png`,
      );
      await page.screenshot({ path: screenshot, fullPage: true });
      record({
        flow,
        ok: status === 200 && bodyText.match(/RelayGate/i) !== null,
        url: page.url(),
        title,
        status,
        body_chars: bodyText.length,
        screenshot,
      });
    });
  } catch (e) {
    record({ flow, ok: false, error: (e as Error).message });
  }
}

interface SeoSnapshot {
  flow: string;
  ok: boolean;
  origin: string;
  robots_status?: number;
  sitemap_status?: number;
  meta_description?: string | null;
  meta_og_title?: string | null;
  meta_og_image?: string | null;
  ld_json_count?: number;
  canonical?: string | null;
  noindex?: boolean;
  errors?: string[];
}

async function flowSeo(
  browser: Browser,
  origin: string,
  flow: string,
): Promise<void> {
  const errors: string[] = [];
  const snap: SeoSnapshot = { flow, ok: false, origin, errors };
  try {
    const robotsRes = await fetch(`${origin}/robots.txt`);
    snap.robots_status = robotsRes.status;
    if (robotsRes.status !== 200) errors.push(`robots ${robotsRes.status}`);

    const sitemapRes = await fetch(`${origin}/sitemap.xml`);
    snap.sitemap_status = sitemapRes.status;
    if (sitemapRes.status !== 200 && sitemapRes.status !== 404) {
      errors.push(`sitemap ${sitemapRes.status}`);
    }

    await withPage(browser, { width: 1440, height: 900 }, async (page) => {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const meta = await page.evaluate(`(function(){
        function get(sel){var el=document.querySelector(sel); return el?el.content:null;}
        var canonicalEl=document.querySelector('link[rel=canonical]');
        var robotsEl=document.querySelector('meta[name=robots]');
        var robotsContent=robotsEl?robotsEl.content:'';
        var ld=document.querySelectorAll('script[type="application/ld+json"]').length;
        return {
          desc: get('meta[name=description]'),
          ogt: get('meta[property="og:title"]'),
          ogi: get('meta[property="og:image"]'),
          canonical: canonicalEl?canonicalEl.href:null,
          noindex: robotsContent.toLowerCase().indexOf('noindex')>=0,
          ld: ld
        };
      })()`) as {
        desc: string | null;
        ogt: string | null;
        ogi: string | null;
        canonical: string | null;
        noindex: boolean;
        ld: number;
      };
      snap.meta_description = meta.desc;
      snap.meta_og_title = meta.ogt;
      snap.meta_og_image = meta.ogi;
      snap.canonical = meta.canonical;
      snap.noindex = meta.noindex;
      snap.ld_json_count = meta.ld;
    });

    snap.ok =
      snap.robots_status === 200 &&
      snap.meta_description !== null &&
      snap.meta_description !== undefined &&
      !snap.noindex;
    if (snap.noindex) errors.push("noindex set");
    if (!snap.meta_description) errors.push("missing meta description");
    record({
      flow,
      ok: snap.ok,
      url: origin,
      details: JSON.stringify({
        robots: snap.robots_status,
        sitemap: snap.sitemap_status,
        desc: snap.meta_description?.slice(0, 80),
        og_title: snap.meta_og_title,
        og_image: snap.meta_og_image,
        canonical: snap.canonical,
        noindex: snap.noindex,
        ld_json_count: snap.ld_json_count,
        errors,
      }),
    });
  } catch (e) {
    record({ flow, ok: false, error: (e as Error).message });
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(CHROME_BIN)) {
    throw new Error(`Chrome binary not found at ${CHROME_BIN}`);
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME_BIN,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    await flowSignInRender(browser);
    await flowSignUpRender(browser);
    await flowCiSessionLogin(browser);
    await flowDashboardMobile(browser);
    await flowMarketingHomeDesktop(browser);
    await flowMarketingHomeMobile(browser);
    await flowSeo(browser, APP_BASE, "seo-app");
    await flowSeo(browser, SITE_BASE, "seo-site");
  } finally {
    await browser.close();
  }

  const summary = {
    ok: results.every((r) => r.ok),
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    flows: results,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, `${STAMP}-summary.json`),
    JSON.stringify(summary, null, 2),
  );
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`[live] FAIL: ${(err as Error).message}\n`);
  process.exitCode = 2;
});
