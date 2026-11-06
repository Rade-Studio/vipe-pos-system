#!/usr/bin/env node
/**
 * Screenshot + overflow harness for the running app (local QA of the redesign, S6).
 *
 * Drives a headless Chromium through CDP with Node built-ins only (Node >= 22),
 * like staging-browser.mjs. Logs each dev role in through the real login form
 * (seed/dev.sql accounts), then captures its main screen, and the admin
 * sections, at every size and theme; runs the overflow CHECK of
 * scripts/design-qa/qa.mjs in the page and collects console errors and failed
 * requests. Writes <role>-<page>-<theme>-<w>x<h>.png and report.json.
 *
 *   node scripts/smoke/app-screens.mjs [--base http://localhost:3000] [--out /tmp/app-screens]
 *     [--roles login,admin,waiter,kitchen,cashier,delivery_operator]
 *     [--sizes 390x844,1024x768,1440x900] [--themes light,dark]
 *     [--paths overview,orders,tables,menu]   (admin sections, #hash)
 *
 * --base defaults to the URL written by `app-stack.sh up`. QA_PASSWORD
 * overrides the dev password (vipe-dev-2026). Exit 0 always unless the run
 * itself fails (2 usage, 3 watchdog); read report.json for the findings.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const urlFile = join(process.env.QA_STATE_DIR ?? "/tmp/vipe-screens-stack", "web.url")
const BASE = (opt("base") ?? (existsSync(urlFile) ? readFileSync(urlFile, "utf8").trim() : "")).replace(/\/$/, "")
if (!BASE) {
  console.error("no --base and no running app-stack (scripts/smoke/app-stack.sh up)")
  process.exit(2)
}
const OUT = opt("out", join(tmpdir(), "app-screens"))
mkdirSync(OUT, { recursive: true })
const ROLES = opt("roles", "login,admin,waiter,kitchen,cashier,delivery_operator").split(",")
const SIZES = opt("sizes", "390x844,1024x768,1440x900").split(",").map((s) => s.split("x").map(Number))
const THEMES = opt("themes", "light,dark").split(",")
const PATHS = opt("paths", "overview,orders,tables,menu").split(",")
const PASSWORD = process.env.QA_PASSWORD ?? "vipe-dev-2026"
const CHROME = process.env.CHROME_BIN ?? join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome")
const ACCOUNTS = {
  admin: "admin@vipe.local",
  waiter: "mesero@vipe.local",
  cashier: "caja@vipe.local",
  kitchen: "cocina@vipe.local",
  delivery_operator: "domicilios@vipe.local",
}

// The overflow CHECK expression is shared with the design-artboard QA tool.
const qaSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../design-qa/qa.mjs"), "utf8")
const CHECK = qaSource.match(/const CHECK = `([\s\S]*?)`;\n/)[1].replace(/\\\\/g, "\\")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const started = Date.now()
const log = (msg) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s] ${msg}`)
const js = (v) => JSON.stringify(v)

const browsers = []
setTimeout(() => {
  console.error("app-screens: watchdog timeout (240s)")
  for (const b of browsers) b.proc.kill("SIGKILL")
  process.exit(3)
}, 240000).unref()

async function launch(name) {
  const profile = mkdtempSync(join(tmpdir(), `app-screens-${name}-`))
  const proc = spawn(
    CHROME,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
      "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"],
    { stdio: "ignore" },
  )
  browsers.push({ proc, profile })
  const portFile = join(profile, "DevToolsActivePort")
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100)
  const port = readFileSync(portFile, "utf8").split("\n")[0]
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const s = { consoleErrors: [], failedRequests: [], loggedIn: false }
  const requests = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
      return
    }
    const p = m.params
    if (m.method === "Runtime.consoleAPICalled" && p.type === "error")
      s.consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300))
    if (m.method === "Runtime.exceptionThrown")
      s.consoleErrors.push(`exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300)}`)
    if (m.method === "Network.requestWillBeSent") requests.set(p.requestId, p.request)
    if (m.method === "Network.responseReceived" && p.response.status >= 400) {
      // 401s before the login form is submitted are the expected session probe.
      if (!(p.response.status === 401 && !s.loggedIn))
        s.failedRequests.push(`${p.response.status} ${requests.get(p.requestId)?.method ?? ""} ${p.response.url.replace(BASE, "")}`)
    }
    if (m.method === "Network.loadingFailed" && !p.canceled && p.type !== "WebSocket")
      s.failedRequests.push(`failed ${p.errorText} ${(requests.get(p.requestId)?.url ?? "").replace(BASE, "")}`)
  }
  s.send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      pending.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  await new Promise((r) => (ws.onopen = r))
  for (const d of ["Page", "Runtime", "Network"]) await s.send(`${d}.enable`)
  // Hide the `next dev` indicator: it is not part of the product and covers the sidebar.
  await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal { display: none !important }" })))`,
  })
  return s
}

async function evaluate(s, expression) {
  const r = await s.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}

async function waitFor(s, expression, timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await evaluate(s, expression).catch(() => false)) return true
    await sleep(150)
  }
  return false
}

async function setView(s, [w, h], theme) {
  await s.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 })
  await s.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }],
  })
}

// next-themes reads localStorage `theme` before hydration; a reload applies it.
async function load(s, url, theme) {
  await evaluate(s, `localStorage.setItem("theme", ${js(theme)})`).catch(() => {})
  await s.send("Page.navigate", { url })
  // Bounded waits keep one slow screen from eating the run budget; a timeout is logged, not fatal.
  if (!(await waitFor(s, "document.readyState === 'complete'", 20000))) log(`  slow load ${url}`)
  if (!(await waitFor(s, `document.documentElement.classList.contains(${js(theme)}) && !document.body.innerText.includes('Cargando')`, 8000)))
    log(`  still loading or theme not applied: ${url}`)
  await sleep(1200) // lists, charts and fonts settle
}

async function capture(s, report, role, page, size, theme) {
  const [w, h] = size
  const issues = await evaluate(s, CHECK)
  const { data } = await s.send("Page.captureScreenshot", { format: "png" })
  const file = join(OUT, `${role}-${page.replace(/\//g, "_")}-${theme}-${w}x${h}.png`)
  writeFileSync(file, Buffer.from(data, "base64"))
  const consoleErrors = s.consoleErrors.splice(0)
  const failedRequests = s.failedRequests.splice(0)
  report.shots.push({ role, page, theme, size: `${w}x${h}`, screenshot: file, overflow: issues.length, issues, consoleErrors, failedRequests })
  log(`${role} ${page} ${theme} ${w}x${h}: overflow=${issues.length} console=${consoleErrors.length} failed=${failedRequests.length}`)
}

async function login(s, role) {
  await setView(s, [1440, 900], "light")
  await s.send("Page.navigate", { url: `${BASE}/portal` })
  if (!(await waitFor(s, "!!document.querySelector('#email')", 60000))) throw new Error("login form not shown")
  await sleep(2000) // let the initial session check settle (staging-browser.mjs)
  for (const [sel, text] of [["#email", ACCOUNTS[role]], ["#password", PASSWORD]]) {
    await evaluate(s, `document.querySelector(${js(sel)}).focus()`)
    await s.send("Input.insertText", { text })
  }
  s.loggedIn = true
  await evaluate(s, "document.querySelector('form button[type=submit]').click()")
  const ok = await waitFor(s, "!document.querySelector('#password') && !document.body.innerText.includes('Cargando')", 60000)
  await sleep(1500)
  if (!ok || (await evaluate(s, "!!document.querySelector('#password')"))) {
    await evaluate(s, "document.querySelector('#password') && (document.querySelector('#password').value = '')")
    throw new Error(`login did not complete: ${(await evaluate(s, "document.body.innerText.slice(0, 200)")).replace(/\s+/g, " ")}`)
  }
  s.consoleErrors.splice(0)
  s.failedRequests.splice(0)
}

async function main() {
  const report = { base: BASE, startedAt: new Date().toISOString(), roles: {}, shots: [] }
  log(`base ${BASE} -> ${OUT}`)
  for (const role of ROLES) {
    const s = await launch(role)
    try {
      if (role === "login") {
        for (const theme of THEMES)
          for (const size of SIZES) {
            await setView(s, size, theme)
            await load(s, `${BASE}/portal`, theme)
            await waitFor(s, "!!document.querySelector('#email')", 30000)
            await capture(s, report, role, "form", size, theme)
          }
        report.roles[role] = { ok: true }
        continue
      }
      const t0 = Date.now()
      await login(s, role)
      log(`login ${role} in ${Date.now() - t0} ms`)
      report.roles[role] = { ok: true, loginMs: Date.now() - t0 }
      const pages = role === "admin" ? PATHS : ["home"]
      for (const theme of THEMES)
        for (const size of SIZES) {
          await setView(s, size, theme)
          for (const page of pages) {
            await load(s, `${BASE}/portal${page === "home" ? "" : `#${page}`}`, theme)
            await capture(s, report, role, page, size, theme)
          }
        }
    } catch (error) {
      report.roles[role] = { ok: false, error: String(error) }
      log(`FAIL ${role}: ${error}`)
    }
  }
  report.finishedAt = new Date().toISOString()
  report.summary = Object.fromEntries(
    Object.keys(report.roles).map((role) => {
      const shots = report.shots.filter((x) => x.role === role)
      return [role, {
        shots: shots.length,
        overflow: shots.reduce((n, x) => n + x.overflow, 0),
        consoleErrors: shots.reduce((n, x) => n + x.consoleErrors.length, 0),
        failedRequests: shots.reduce((n, x) => n + x.failedRequests.length, 0),
      }]
    }),
  )
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2))
  log(`summary ${js(report.summary)}`)
  log(`report ${join(OUT, "report.json")}`)
}

let code = 0
try {
  await main()
} catch (error) {
  console.error(error)
  code = 1
} finally {
  for (const { proc } of browsers) proc.kill("SIGTERM")
  await sleep(800)
  for (const { proc, profile } of browsers) {
    if (proc.exitCode === null) proc.kill("SIGKILL")
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
  }
}
process.exit(code)
