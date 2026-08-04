import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const edgePaths = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function existingPath(paths) {
  for (const candidate of paths) {
    try {
      await stat(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const filePath = path.resolve(dist, relative);
      if (filePath !== dist && !filePath.startsWith(`${dist}${path.sep}`)) throw new Error("invalid path");
      const data = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(data);
    } catch {
      if (!response.headersSent) response.writeHead(404).end("Not found");
      else response.destroy();
    }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function waitForJson(url, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };
  return {
    ready: new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error("Could not connect to browser debugging socket"));
    }),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function main() {
  const edge = await existingPath(edgePaths);
  if (!edge) throw new Error("Microsoft Edge was not found");
  const server = await startServer();
  const address = server.address();
  const browserPort = 9333;
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "geomap-edge-"));
  const browser = spawn(edge, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${browserPort}`,
    `--user-data-dir=${profileDirectory}`,
    `http://127.0.0.1:${address.port}/`,
  ], { stdio: "ignore" });

  try {
    const tabs = await waitForJson(`http://127.0.0.1:${browserPort}/json/list`);
    const tab = tabs.find(item => item.type === "page");
    if (!tab) throw new Error("Browser page was not created");
    const cdp = connectCdp(tab.webSocketDebuggerUrl);
    await cdp.ready;
    await new Promise(resolve => setTimeout(resolve, 500));
    const evaluate = async expression => {
      const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        throw new Error(detail);
      }
      return result.result.value;
    };
    await evaluate(`new Promise(resolve => {
      const wait = () => document.querySelectorAll('.profile-button').length === 4 ? resolve() : setTimeout(wait, 20);
      wait();
    })`);
    await evaluate(`document.querySelector('[data-profile-id="profile3"]').click()`);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

    const provinceCount = await evaluate(`document.querySelectorAll('.country-click-target[data-adcode]').length`);
    if (provinceCount !== 34) throw new Error(`Expected 34 clickable provinces, found ${provinceCount}`);

    const clickPoint = await evaluate(`(() => {
      const path = document.querySelector('.country-click-target[data-adcode="420000"]');
      const bounds = path.getBoundingClientRect();
      for (let row = 1; row < 20; row += 1) {
        for (let column = 1; column < 20; column += 1) {
          const x = bounds.left + bounds.width * column / 20;
          const y = bounds.top + bounds.height * row / 20;
          if (document.elementFromPoint(x, y) === path) return { x, y };
        }
      }
      throw new Error('Could not find a hittable point in Hubei');
    })()`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: clickPoint.x, y: clickPoint.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: clickPoint.x, y: clickPoint.y, button: "left", clickCount: 1 });
    const hubeiTitle = await evaluate(`document.querySelector('.doc-title')?.textContent.trim()`);
    if (!hubeiTitle?.includes("湖北")) throw new Error(`Real click did not open Hubei; title is ${hubeiTitle || "missing"}`);

    const failures = await evaluate(`(() => {
      const failures = [];
      for (const target of document.querySelectorAll('.country-click-target[data-adcode]')) {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        const expected = window.PLONKIT_CHINA_PAGES.adcodePages[target.dataset.adcode]?.[0];
        const activeTitle = document.querySelector('.doc-title')?.textContent.trim();
        const page = window.PLONKIT_CHINA_PAGES.pages.find(candidate => candidate.slug === expected);
        if (!page || (activeTitle !== page.title && activeTitle !== '中国' + page.title)) {
          failures.push({ adcode: target.dataset.adcode, expected: page?.title, activeTitle });
        }
      }
      return failures;
    })()`);
    if (failures.length) throw new Error(`Province rendering failures: ${JSON.stringify(failures)}`);

    for (const [adcode, expectedTabs] of [["310000", 0], ["500000", 2]]) {
      const tabsResult = await evaluate(`(() => {
        document.querySelector('.country-click-target[data-adcode="${adcode}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        const tabs = [...document.querySelectorAll('.page-tab')];
        const firstTitle = document.querySelector('.doc-title')?.textContent.trim();
        tabs.at(-1)?.click();
        return { count: tabs.length, firstTitle, switchedTitle: document.querySelector('.doc-title')?.textContent.trim() };
      })()`);
      const didSwitch = tabsResult.firstTitle !== tabsResult.switchedTitle;
      if (tabsResult.count !== expectedTabs || (expectedTabs > 1 && !didSwitch)) {
        throw new Error(`Tab test failed for ${adcode}: ${JSON.stringify(tabsResult)}`);
      }
    }

    await evaluate(`document.querySelector('[data-profile-id="profile1"]').click()`);
    await evaluate(`document.querySelector('.country-click-target[data-code~="USA"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`);
    const pasteResult = await evaluate(`(async () => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), character => character.charCodeAt(0));
      const clipboard = new DataTransfer();
      clipboard.items.add(new File([bytes], 'clipboard-test.png', { type: 'image/png' }));
      document.querySelector('#paste-image-zone').dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }));
      const deadline = Date.now() + 3000;
      while ((!document.querySelector('#selection-status')?.textContent.includes('已粘贴')
          || !document.querySelector('.image-overlay image[href^="data:image/png"]')) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const preview = document.querySelector('.article img[src^="data:image/png"]');
      return {
        status: document.querySelector('#selection-status')?.textContent || '',
        hasPreview: Boolean(preview),
        hasMapImage: Boolean(document.querySelector('.image-overlay image[href^="data:image/png"]')),
        selected: Boolean(preview?.closest('.image-choice')?.classList.contains('selected-image')),
      };
    })()`);
    if (!pasteResult.hasPreview || !pasteResult.hasMapImage || !pasteResult.selected || !pasteResult.status.includes("已粘贴")) {
      throw new Error(`Clipboard image test failed: ${JSON.stringify(pasteResult)}`);
    }
    cdp.close();
    console.log("Verified province pages, Shanghai fallback, Chongqing tabs, and clipboard image preview/selection.");
  } finally {
    browser.kill();
    await Promise.race([
      new Promise(resolve => browser.once("exit", resolve)),
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ]);
    await new Promise(resolve => server.close(resolve));
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await main();
