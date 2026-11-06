// Visual QA for gentle-design artboards (design/<slug>/*.html): screenshots + overflow detection.
// Usage: node scripts/design-qa/qa.mjs <artboard.html> [outDir] [--viewports=390x844,768x1024,1024x768,1440x900] [--themes=light,dark]
// Theme contract: the artboard reads <html data-theme="light|dark">.
// Elements (or ancestors) with data-qa-ignore are skipped (decorative bleed, intentional scrollers).
// Writes <theme>-<w>x<h>.png, <theme>-<w>x<h>-full.png (internal scrollers unrolled) and report.json.
// Exit 0 when no issue is found, 1 otherwise, 3 on watchdog timeout.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, basename } from "node:path";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const file = resolve(positional[0] ?? "");
if (!existsSync(file)) { console.error("usage: qa.mjs <artboard.html> [outDir]"); process.exit(2); }
const outDir = resolve(positional[1] ?? join(tmpdir(), "design-qa", basename(file, ".html")));
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const viewports = opt("viewports", "390x844,768x1024,1024x768,1440x900").split(",").map((v) => v.split("x").map(Number));
const themes = opt("themes", "light,dark").split(",");
mkdirSync(outDir, { recursive: true });

const CHROME = process.env.CHROME_BIN ?? join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
const profile = mkdtempSync(join(tmpdir(), "design-qa-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
// Watchdog: never hang a caller for more than 3 minutes.
setTimeout(() => { console.error("qa.mjs: watchdog timeout (180s)"); try { chrome.kill("SIGKILL"); } catch {} process.exit(3); }, 180000).unref();
const wsUrl = await new Promise((res, rej) => {
  let buf = "";
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
  setTimeout(() => rej(new Error("chrome did not start")), 15000);
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map(); const listeners = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else listeners.forEach((l) => l(m)); });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const CHECK = `(() => {
  const ign = (el) => el.closest('[data-qa-ignore]');
  const path = (el) => { const p = []; for (let e = el; e && e !== document.body && p.length < 4; e = e.parentElement) { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; else if (e.classList.length) s += '.' + [...e.classList].slice(0, 2).join('.'); p.unshift(s); } return p.join(' > '); };
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const scroller = (cs) => ['auto', 'scroll'].includes(cs.overflowX);
  const out = []; const vw = innerWidth;
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) out.push({ type: 'page-horizontal-overflow', by: sw - vw });
  for (const el of document.querySelectorAll('body *')) {
    if (ign(el) || !vis(el)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;
    if ((cs.clip && cs.clip !== 'auto') || cs.clipPath.startsWith('inset(50%') || (r.width <= 1 && r.height <= 1)) continue;
    const txt = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 50);
    if (!scroller(cs) && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && ['inline-block','block','flex','inline-flex','grid','table-cell'].includes(cs.display))
      out.push({ type: cs.overflowX === 'hidden' ? 'content-clipped' : 'content-overflows-box', sel: path(el), text: txt, by: el.scrollWidth - el.clientWidth, viewportX: Math.round(r.left) });
    const p = el.parentElement;
    if (p && p !== document.body && cs.position !== 'absolute') {
      const pr = p.getBoundingClientRect(); const pcs = getComputedStyle(p);
      if (!scroller(pcs) && (r.right > pr.right + 2 || r.left < pr.left - 2))
        out.push({ type: 'escapes-parent', sel: path(el), text: txt, by: Math.round(Math.max(r.right - pr.right, pr.left - r.left)) });
    }
    if (r.right > vw + 2) { let s = el.parentElement, inScroller = false; while (s && s !== document.body) { if (scroller(getComputedStyle(s))) { inScroller = true; break; } s = s.parentElement; } if (!inScroller) out.push({ type: 'off-viewport', sel: path(el), text: txt, by: Math.round(r.right - vw) }); }
  }
  const seen = new Set(); return out.filter((o) => { const k = o.type + o.sel; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 80);
})()`;

// Unroll internal vertical scrollers (app shells with 100vh panes) so hidden content is captured.
const UNROLL = `(() => { for (const el of [document.documentElement, document.body, ...document.querySelectorAll('body *')]) { const cs = getComputedStyle(el); if (['auto','scroll'].includes(cs.overflowY) || (cs.height.endsWith('px') && el.scrollHeight > el.clientHeight + 2 && cs.overflowY === 'hidden' && !el.closest('[data-qa-ignore]'))) { el.style.setProperty('overflow-y','visible','important'); el.style.setProperty('height','auto','important'); el.style.setProperty('max-height','none','important'); } } document.documentElement.style.setProperty('height','auto','important'); document.body.style.setProperty('height','auto','important'); return Math.min(6000, document.documentElement.scrollHeight); })()`;

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
const report = { file, results: [] };
for (const theme of themes) {
  for (const [w, h] of viewports) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, sessionId);
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
    const loaded = new Promise((r) => { const l = (m) => { if (m.method === "Page.loadEventFired" && m.sessionId === sessionId) { listeners.splice(listeners.indexOf(l), 1); r(); } }; listeners.push(l); });
    await send("Page.navigate", { url: `file://${file}` }, sessionId);
    await Promise.race([loaded, new Promise((r) => setTimeout(r, 20000))]);
    await send("Runtime.evaluate", { expression: `document.documentElement.dataset.theme=${JSON.stringify(theme)}; window.dispatchEvent(new Event('resize'))` }, sessionId);
    await new Promise((r) => setTimeout(r, 400));
    const { result } = await send("Runtime.evaluate", { expression: CHECK, returnByValue: true }, sessionId);
    const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    const png = join(outDir, `${theme}-${w}x${h}.png`);
    writeFileSync(png, Buffer.from(shot.data, "base64"));
    const { result: hres } = await send("Runtime.evaluate", { expression: UNROLL, returnByValue: true }, sessionId);
    if (hres.value > h + 4) {
      const full = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: hres.value, scale: 1 } }, sessionId);
      writeFileSync(join(outDir, `${theme}-${w}x${h}-full.png`), Buffer.from(full.data, "base64"));
    }
    report.results.push({ theme, viewport: `${w}x${h}`, screenshot: png, issues: result.value });
    console.log(`${theme} ${w}x${h}: ${result.value.length} issues -> ${png}`);
  }
}
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
const total = report.results.reduce((n, r) => n + r.issues.length, 0);
console.log(`TOTAL ${total} issues; report ${join(outDir, "report.json")}`);
ws.close();
await new Promise((r) => { chrome.once("exit", r); chrome.kill(); });
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
process.exit(total ? 1 : 0);
