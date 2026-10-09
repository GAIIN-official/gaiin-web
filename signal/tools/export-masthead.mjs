#!/usr/bin/env node
/**
 * Export signal/masthead.html to a 1200×480 PNG.
 *
 *   node signal/tools/export-masthead.mjs
 *   node signal/tools/export-masthead.mjs --out signal/2026-10-06-hero.png \
 *     --issueDate "06 OCT 2026" \
 *     --headline "Hong Kong leads workplace AI — training still lags" \
 *     --hook "Five reads on AI and innovation from across the network."
 *
 * Uses the system Chrome (CHROME_PATH, google-chrome, or chromium).
 * Viewport is locked at 1200×480 with deviceScaleFactor 1.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WIDTH = 1200;
const HEIGHT = 480;

function parseArgs(argv) {
  const opts = {
    out: path.join(root, "signal/2026-10-06-hero.png"),
    issueDate: null,
    headline: null,
    hook: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error("Missing value for " + arg);
      return value;
    };
    if (arg === "--out") opts.out = path.resolve(next());
    else if (arg === "--issueDate") opts.issueDate = next();
    else if (arg === "--headline") opts.headline = next();
    else if (arg === "--hook") opts.hook = next();
    else if (arg === "--help" || arg === "-h") {
      console.log("node signal/tools/export-masthead.mjs [--out file.png] [--issueDate s] [--headline s] [--hook s]");
      process.exit(0);
    } else {
      throw new Error("Unknown argument " + arg);
    }
  }
  return opts;
}

function chromeBin() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;
  return "google-chrome";
}

function mastheadUrl(opts) {
  const file = path.join(root, "signal/masthead.html");
  const url = new URL("file://" + file);
  for (const key of ["issueDate", "headline", "hook"]) {
    if (opts[key]) url.searchParams.set(key, opts[key]);
  }
  return url.href;
}

async function waitForPort(userDataDir) {
  const portFile = path.join(userDataDir, "DevToolsActivePort");
  for (let i = 0; i < 80; i++) {
    try {
      const text = await readFile(portFile, "utf8");
      const port = text.split("\n")[0].trim();
      if (port) return port;
    } catch {
      /* chrome still starting */
    }
    await delay(50);
  }
  throw new Error("Chrome did not open a DevTools port");
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("DevTools socket failed")));
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
    else resolve(message.result);
  });
  function send(method, params = {}, sessionId) {
    const msgId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject });
      const payload = { id: msgId, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });
  }
  return { ws, opened, send };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "masthead-chrome-"));
  const chrome = spawn(chromeBin(), [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--allow-file-access-from-files",
    "--force-device-scale-factor=1",
    "--disable-font-subpixel-positioning",
    "--font-render-hinting=none",
    `--window-size=${WIDTH},${HEIGHT}`,
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let chromeLog = "";
  chrome.stderr.on("data", (chunk) => { chromeLog += chunk; });
  chrome.stdout.on("data", (chunk) => { chromeLog += chunk; });

  try {
    const port = await waitForPort(userDataDir);
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json());
    const browser = connect(version.webSocketDebuggerUrl);
    await browser.opened;

    const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(mastheadUrl(opts))}`, {
      method: "PUT",
    }).then(async (res) => {
      if (!res.ok) throw new Error("json/new failed: " + res.status + " " + await res.text());
      return res.json();
    });

    const page = connect(created.webSocketDebuggerUrl);
    await page.opened;
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.send("Page.navigate", { url: mastheadUrl(opts) });
    await page.send("Runtime.evaluate", {
      expression: `document.fonts.ready.then(() => {
        const headline = getComputedStyle(document.querySelector(".headline"));
        const hook = getComputedStyle(document.querySelector(".hook"));
        const date = getComputedStyle(document.querySelector(".date"));
        const expect = [
          [headline.fontFamily, "Playfair Display"],
          [hook.fontFamily, "Libre Franklin"],
          [date.fontFamily, "Fragment Mono"],
        ];
        for (const [actual, name] of expect) {
          if (!actual.includes(name)) throw new Error(name + " did not load: " + actual);
        }
        const box = document.querySelector("#masthead").getBoundingClientRect();
        if (box.width !== ${WIDTH} || box.height !== ${HEIGHT}) {
          throw new Error("artboard is " + box.width + "x" + box.height);
        }
        return document.querySelector(".headline").textContent;
      })`,
      awaitPromise: true,
      returnByValue: true,
    });

    const shot = await page.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
      captureBeyondViewport: false,
    });
    await writeFile(opts.out, Buffer.from(shot.data, "base64"));
    page.ws.close();
    browser.ws.close();
    console.log(opts.out);
  } catch (error) {
    console.error(chromeLog.slice(-2000));
    throw error;
  } finally {
    chrome.kill();
    await delay(100);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
