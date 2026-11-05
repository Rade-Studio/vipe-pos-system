#!/usr/bin/env node
/**
 * Per-role browser smoke test for a deployed VIPE POS (staging or production).
 *
 * Drives a headless Chromium through the Chrome DevTools Protocol using only
 * Node built-ins (global WebSocket and fetch, Node >= 22). No packages needed.
 *
 * Run:
 *   DEMO_PASSWORD=... SMOKE_BASE_URL=https://vipe-staging.example \
 *   CHROME_BIN=~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
 *   node scripts/smoke/staging-browser.mjs [--out /tmp/vipe-smoke-XXXX] [--skip-realtime]
 *
 * Env:
 *   SMOKE_BASE_URL  base URL of the web (the API is same-origin under /api).
 *   DEMO_PASSWORD   shared password of the demo users. Read from env only;
 *                   it is typed into the login form and never logged.
 *   SMOKE_USERS     optional comma list overriding the five demo users.
 *   CHROME_BIN      Chromium binary.
 *   SMOKE_FAST_SUBMIT=1  submit the login form as soon as it renders.
 *   SMOKE_DEBUG=1   print every /api response.
 *
 * What it does: logs in each user through the real form, visits that role's
 * screens (screenshots, console errors, failed requests, data heuristics),
 * then with the waiter and kitchen sessions open creates an order from the
 * waiter context, waits for the kitchen DOM to show it, serves it from the
 * kitchen UI, waits for the waiter's table card to change, checks the
 * socket.io WebSocket stayed open, deletes the order as admin, and finally
 * logs one user out and checks the portal falls back to the login form.
 * Writes report.json in the output directory and exits 1 on any FAIL.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"

const BASE = (process.env.SMOKE_BASE_URL ?? "").replace(/\/$/, "")
const PASSWORD = process.env.DEMO_PASSWORD ?? ""
const CHROME =
  process.env.CHROME_BIN ?? join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome")
if (!BASE || !PASSWORD) {
  console.error("SMOKE_BASE_URL and DEMO_PASSWORD are required in env")
  process.exit(2)
}
const args = process.argv.slice(2)
const outArg = args.indexOf("--out")
const OUT = outArg >= 0 ? args[outArg + 1] : mkdtempSync(join(tmpdir(), "vipe-smoke-"))
mkdirSync(OUT, { recursive: true })
const SKIP_REALTIME = args.includes("--skip-realtime")

const USERS = (process.env.SMOKE_USERS ??
  "admin@demo.vipe.pos,mesero.andres@demo.vipe.pos,cocina@demo.vipe.pos,caja@demo.vipe.pos,domicilios@demo.vipe.pos"
).split(",")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now()

// ---------- browser + CDP ----------

const browsers = []

async function launch(name) {
  const profile = mkdtempSync(join(tmpdir(), `vipe-smoke-profile-${name}-`))
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  )
  browsers.push({ proc, profile })
  const portFile = join(profile, "DevToolsActivePort")
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100)
  const port = readFileSync(portFile, "utf8").split("\n")[0]
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === "page")
  return connect(page.webSocketDebuggerUrl, name)
}

function connect(wsUrl, name) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const listeners = new Map()
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn])
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result)
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      pending.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  return new Promise((resolve) => (ws.onopen = () => resolve(session({ send, on, name }))))
}

async function session(cdp) {
  const s = {
    ...cdp,
    consoleErrors: [],
    failedRequests: [],
    sockets: new Map(), // requestId -> {url, created, closed, framesIn, framesOut}
    loggedIn: false,
  }
  const requests = new Map()
  const preLogin = new Set() // requests sent before the form was submitted
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error")
      s.consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300))
  })
  cdp.on("Runtime.exceptionThrown", (p) =>
    s.consoleErrors.push(`exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300)}`),
  )
  cdp.on("Log.entryAdded", (p) => {
    if (p.entry.level === "error" && p.entry.source !== "network")
      s.consoleErrors.push(`${p.entry.source}: ${p.entry.text}`.slice(0, 300))
  })
  cdp.on("Network.requestWillBeSent", (p) => {
    requests.set(p.requestId, p.request)
    if (!s.loggedIn) preLogin.add(p.requestId)
  })
  cdp.on("Network.responseReceived", (p) => {
    const { status, url } = p.response
    if (process.env.SMOKE_DEBUG && url.includes("/api/"))
      console.log(`  [${s.name}] ${status} ${requests.get(p.requestId)?.method} ${url.replace(BASE, "")}`)
    if (status < 400) return
    if (status === 401 && preLogin.has(p.requestId)) return // expected before login
    s.failedRequests.push(`${status} ${requests.get(p.requestId)?.method ?? ""} ${url.replace(BASE, "")}`)
  })
  cdp.on("Network.loadingFailed", (p) => {
    if (p.canceled || p.type === "WebSocket") return
    s.failedRequests.push(`failed ${p.errorText} ${(requests.get(p.requestId)?.url ?? "").replace(BASE, "")}`)
  })
  cdp.on("Network.webSocketCreated", (p) =>
    s.sockets.set(p.requestId, { url: p.url.replace(BASE.replace(/^http/, "ws"), ""), created: now(), closed: null, framesIn: 0, framesOut: 0 }),
  )
  cdp.on("Network.webSocketClosed", (p) => {
    const w = s.sockets.get(p.requestId)
    if (w) w.closed = now()
  })
  cdp.on("Network.webSocketFrameReceived", (p) => {
    const w = s.sockets.get(p.requestId)
    if (w) w.framesIn++
  })
  cdp.on("Network.webSocketFrameSent", (p) => {
    const w = s.sockets.get(p.requestId)
    if (w) w.framesOut++
  })
  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  await cdp.send("Network.enable")
  await cdp.send("Log.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  return s
}

async function evaluate(s, expression) {
  const r = await s.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}

async function waitFor(s, expression, timeoutMs = 15000, interval = 100) {
  const start = now()
  while (now() - start < timeoutMs) {
    if (await evaluate(s, expression).catch(() => false)) return now() - start
    await sleep(interval)
  }
  return null
}

async function navigate(s, url) {
  await s.send("Page.navigate", { url })
  await waitFor(s, "document.readyState === 'complete'", 30000)
}

async function screenshot(s, file) {
  const { data } = await s.send("Page.captureScreenshot", { format: "png" })
  const path = join(OUT, file)
  writeFileSync(path, Buffer.from(data, "base64"))
  return path
}

const js = (v) => JSON.stringify(v)

/** Clicks the first visible element matching `selector` whose text includes `text`. */
const clickText = (s, selector, text) =>
  evaluate(
    s,
    `(() => { const el = [...document.querySelectorAll(${js(selector)})].find(e => e.offsetParent !== null && e.textContent.includes(${js(text)})); if (!el) return false; el.click(); return true })()`,
  )

async function typeInto(s, selector, text) {
  await evaluate(s, `document.querySelector(${js(selector)}).focus()`)
  await s.send("Input.insertText", { text })
}

/** API call from the page context, with the session cookies. */
const api = (s, method, path, body) =>
  evaluate(
    s,
    `fetch(${js(path)}, { method: ${js(method)}, credentials: "include", headers: { "content-type": "application/json" }, ${
      body === undefined ? "" : `body: ${js(JSON.stringify(body))}`
    } }).then(async r => ({ status: r.status, body: await r.text().then(t => { try { return JSON.parse(t) } catch { return t } }) }))`,
  )

// ---------- pages per role ----------

const ADMIN_SECTIONS = [
  "overview", "orders", "tables", "cash", "menu", "formulas",
  "inventory/overview", "inventory/items", "inventory/movements", "inventory/purchases",
  "inventory/production", "inventory/counts", "inventory/locations",
  "settings/business", "settings/payment-methods", "settings/delivery", "settings/staff", "settings/printers",
]

const ROLE_PAGES = {
  waiter: [["tables", "Mesas"], ["orders", "Órdenes"]],
  kitchen: [["tables", "Mesas"], ["orders", "Órdenes Pendientes"]],
  cashier: [["orders", "Órdenes"], ["transactions", "Transacciones"]],
  delivery_operator: [
    ["received", "Recibido"], ["preparing", "En preparación"], ["ready", "Listo"],
    ["out_for_delivery", "En camino"], ["closed", "Cerrados hoy"],
  ],
}

const DATA_PROBE = `(() => {
  const root = document.querySelector("main") ?? document.body
  const visible = (e) => e.offsetParent !== null
  const text = root.innerText
  return {
    textLength: text.length,
    tableRows: [...root.querySelectorAll("tbody tr")].filter(visible).length,
    cards: [...root.querySelectorAll("[class*='rounded-lg'][class*='border'], [class*='rounded-xl'][class*='border']")].filter(visible).length,
    charts: root.querySelectorAll(".recharts-surface, canvas").length,
    images: [...root.querySelectorAll("img")].filter(i => visible(i) && i.naturalWidth > 0).length,
    brokenImages: [...root.querySelectorAll("img")].filter(i => visible(i) && i.complete && i.naturalWidth === 0).map(i => i.src).slice(0, 5),
    emptyStates: (text.match(/No hay[^\\n]{0,60}|Sin [a-zá-ú]+ [^\\n]{0,40}/g) ?? []).slice(0, 5),
    errorBanners: (text.match(/Error[^\\n]{0,80}|No se pudo[^\\n]{0,80}/g) ?? []).slice(0, 5),
  }
})()`

async function recordPage(s, results, role, page) {
  await sleep(2500) // let lists and charts settle
  const probe = await evaluate(s, DATA_PROBE)
  const file = await screenshot(s, `${role}-${page.replace(/\//g, "_")}.png`)
  const consoleErrors = s.consoleErrors.splice(0)
  const failedRequests = s.failedRequests.splice(0)
  const hasData = probe.tableRows > 0 || probe.cards > 2 || probe.charts > 0
  const ok = consoleErrors.length === 0 && failedRequests.length === 0 && probe.errorBanners.length === 0
  results.push({ role, page, ok, hasData, consoleErrors, failedRequests, probe, screenshot: file })
  console.log(`${ok ? "OK  " : "FAIL"} ${role} ${page} data=${hasData} rows=${probe.tableRows} cards=${probe.cards} charts=${probe.charts}${consoleErrors.length ? ` console=${consoleErrors.length}` : ""}${failedRequests.length ? ` failed=${failedRequests.join(" | ")}` : ""}`)
}

async function login(s, email) {
  await navigate(s, `${BASE}/portal`)
  if ((await waitFor(s, "!!document.querySelector('#email')", 30000)) === null) throw new Error("login form not shown")
  // The form renders before the initial me -> refresh -> me check settles; a
  // submit inside that window can be signed out by it (SMOKE_FAST_SUBMIT=1
  // reproduces it). By default type like a person, after the check.
  if (!process.env.SMOKE_FAST_SUBMIT) await sleep(2000)
  await typeInto(s, "#email", email)
  await typeInto(s, "#password", PASSWORD)
  s.loggedIn = true // 401s from here on are real failures
  await evaluate(s, "document.querySelector('form button[type=submit]').click()")
  let ms = await waitFor(s, "!document.querySelector('#password') && !document.body.innerText.includes('Cargando')", 30000)
  // The shell must stay signed in, not bounce back to the form.
  await sleep(2000)
  if (await evaluate(s, "!!document.querySelector('#password')")) ms = null
  if (ms === null) {
    await evaluate(s, "document.querySelector('#password') && (document.querySelector('#password').value = '')")
    const text = await evaluate(s, "document.body.innerText.slice(0, 300)")
    throw new Error(`login did not complete: ${text}`)
  }
  const me = await api(s, "GET", "/api/auth/me")
  return { ms, me: me.body }
}

async function walkRole(s, role, results) {
  if (role === "admin") {
    for (const section of ADMIN_SECTIONS) {
      await evaluate(s, `location.hash = ${js(section)}`)
      await sleep(300)
      await recordPage(s, results, role, section)
    }
    return
  }
  const pages = ROLE_PAGES[role] ?? []
  await recordPage(s, results, role, "home")
  for (const [id, label] of pages) {
    if (!(await clickTab(s, label))) {
      results.push({ role, page: id, ok: false, hasData: false, consoleErrors: [], failedRequests: [], note: `tab "${label}" not found` })
      console.log(`FAIL ${role} ${id} tab not found`)
      continue
    }
    await recordPage(s, results, role, id)
  }
}

// Radix tabs activate on mousedown, not on click.
const clickTab = (s, label) =>
  evaluate(
    s,
    `(() => { const el = [...document.querySelectorAll("[role=tab]")].find(e => e.offsetParent !== null && e.textContent.trim().startsWith(${js(label)})); if (!el) return false; el.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, button: 0})); el.click(); return true })()`,
  )

// ---------- realtime scenario ----------

async function realtime(waiter, kitchen, admin, waiterMe) {
  const report = { steps: [] }
  await clickTab(kitchen, "Órdenes Pendientes")
  await clickTab(waiter, "Mesas")
  await sleep(1500)

  const tables = (await api(waiter, "GET", "/api/tables")).body
  const free = tables.find((t) => t.status === "available")
  if (!free) throw new Error("no available table")
  const dishes = (await api(waiter, "GET", "/api/catalog/dishes?active=true&pricing=promotions")).body
  const dish = dishes.find((d) => d.isActive !== false) ?? dishes[0]
  report.table = free.number
  report.dish = dish.name

  const kitchenCards = (n) =>
    `[...document.querySelectorAll("div")].filter(e => e.className.includes?.("mb-4") && e.innerText?.includes("Mesa ${n}") && e.innerText.includes("Entregar")).length`
  const before = await evaluate(kitchen, kitchenCards(free.number))

  const assign = await api(waiter, "POST", `/api/tables/${free.id}/assign`, { waiterId: waiterMe.profile.id })
  const t0 = now()
  const created = await api(waiter, "POST", "/api/orders", {
    tableId: free.id, orderType: "dine_in", force: true,
    items: [{ dishId: dish.id, quantity: 1, comments: "smoke D3" }],
  })
  report.steps.push({ step: "assign", status: assign.status }, { step: "create order", status: created.status, ms: now() - t0 })
  if (created.status !== 201) throw new Error(`create order: ${created.status} ${js(created.body)}`)
  report.orderId = created.body.id

  const kitchenMs = await waitFor(kitchen, `${kitchenCards(free.number)} > ${before}`, 15000, 50)
  report.kitchenSawTicketMs = kitchenMs === null ? null : now() - t0
  report.kitchenScreenshot = await screenshot(kitchen, "realtime-kitchen-ticket.png")

  const waiterCard = `[...document.querySelectorAll("div.h-36")].find(e => e.innerText.includes("Mesa ${free.number}\\n") || e.innerText.startsWith("Mesa ${free.number}"))?.className ?? ""`
  report.waiterCardBefore = (await evaluate(waiter, waiterCard)).match(/bg-(\w+)-50/)?.[1]

  // Serve the single item from the kitchen UI.
  const clicked = await evaluate(
    kitchen,
    `(() => { const card = [...document.querySelectorAll("div")].reverse().find(e => e.className.includes?.("mb-4") && e.innerText?.includes("Mesa ${free.number}") && e.innerText.includes("smoke D3")) ?? [...document.querySelectorAll("div")].reverse().find(e => e.className.includes?.("mb-4") && e.innerText?.includes("Mesa ${free.number}")); if (!card) return false; const b = [...card.querySelectorAll("button")].find(b => b.textContent.trim() === "Entregar"); if (!b) return false; b.click(); return true })()`,
  )
  const t1 = now()
  report.steps.push({ step: "kitchen click Entregar", clicked })
  const waiterMs = await waitFor(waiter, `!(${waiterCard}).includes("bg-${report.waiterCardBefore}-50")`, 15000, 50)
  report.waiterSawUpdateMs = waiterMs === null ? null : now() - t1
  report.waiterCardAfter = (await evaluate(waiter, waiterCard)).match(/bg-(\w+)-50/)?.[1]
  report.waiterScreenshot = await screenshot(waiter, "realtime-waiter-table.png")
  const order = await api(waiter, "GET", `/api/orders/${report.orderId}`)
  report.orderStatusAfterServe = order.body?.status

  for (const [name, s] of [["waiter", waiter], ["kitchen", kitchen]]) {
    const ws = [...s.sockets.values()].filter((w) => w.url.includes("/socket.io/?EIO=4&transport=websocket"))
    report[`${name}Sockets`] = ws.map((w) => ({ url: w.url.slice(0, 60), open: w.closed === null, framesIn: w.framesIn, framesOut: w.framesOut, ageS: Math.round((now() - w.created) / 1000) }))
  }

  // Cleanup: admin deletes the order, which frees the table.
  const del = await api(admin, "DELETE", `/api/orders/${report.orderId}`)
  const tableAfter = (await api(admin, "GET", "/api/tables")).body.find((t) => t.id === free.id)
  report.cleanup = { deleteStatus: del.status, tableStatusAfter: tableAfter?.status }
  report.consoleErrors = { waiter: waiter.consoleErrors.splice(0), kitchen: kitchen.consoleErrors.splice(0) }
  report.failedRequests = { waiter: waiter.failedRequests.splice(0), kitchen: kitchen.failedRequests.splice(0) }
  return report
}

// ---------- main ----------

async function main() {
  const results = []
  const sessions = {}
  const report = { base: BASE, out: OUT, startedAt: new Date().toISOString(), logins: {}, pages: results }
  for (const email of USERS) {
    const s = await launch(email.split("@")[0].replace(/\W/g, "_"))
    try {
      const { ms, me } = await login(s, email)
      const role = me?.profile?.role ?? "unknown"
      report.logins[email] = { ok: true, ms, role }
      console.log(`login ${email} -> ${role} in ${ms} ms`)
      sessions[role] = { s, me }
      await walkRole(s, role, results)
    } catch (error) {
      report.logins[email] = { ok: false, error: String(error) }
      results.push({ role: email, page: "login", ok: false, error: String(error), screenshot: await screenshot(s, `${email.split("@")[0]}-login-fail.png`) })
      console.log(`FAIL login ${email}: ${error}`)
    }
  }

  if (!SKIP_REALTIME && sessions.waiter && sessions.kitchen && sessions.admin) {
    try {
      report.realtime = await realtime(sessions.waiter.s, sessions.kitchen.s, sessions.admin.s, sessions.waiter.me)
      console.log("realtime", js(report.realtime))
    } catch (error) {
      report.realtime = { error: String(error) }
      console.log(`FAIL realtime: ${error}`)
    }
  }

  // Logout through the UI header button, then the protected portal must show the login form.
  const out = sessions.delivery_operator?.s ?? sessions.cashier?.s
  if (out) {
    const clicked = await clickText(out, "button", "Cerrar Sesión")
    const loginMs = await waitFor(out, "!!document.querySelector('#email')", 15000)
    const me = await api(out, "GET", "/api/auth/me")
    out.loggedIn = false
    await navigate(out, `${BASE}/portal`)
    const afterReload = await waitFor(out, "!!document.querySelector('#email')", 15000)
    report.logout = { clicked, loginFormMs: loginMs, meStatus: me.status, loginFormAfterReloadMs: afterReload, screenshot: await screenshot(out, "logout-login-form.png") }
    console.log("logout", js(report.logout))
  }

  report.finishedAt = new Date().toISOString()
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2))
  console.log(`report: ${join(OUT, "report.json")}`)
  const failed =
    results.some((r) => !r.ok) || report.realtime?.error || report.realtime?.kitchenSawTicketMs == null ||
    report.realtime?.waiterSawUpdateMs == null || report.logout?.loginFormAfterReloadMs == null
  return failed ? 1 : 0
}

let code = 1
try {
  code = await main()
} catch (error) {
  console.error(error)
} finally {
  for (const { proc } of browsers) proc.kill("SIGTERM")
  await sleep(1000)
  for (const { proc } of browsers) if (proc.exitCode === null) proc.kill("SIGKILL")
  console.log(`profiles to remove: ${browsers.map((b) => b.profile).join(" ")}`)
}
process.exit(code)
