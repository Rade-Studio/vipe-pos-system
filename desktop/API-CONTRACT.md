# VIPE desktop ↔ VIPE API contract

What the desktop app (`desktop/app`) expects from the VIPE API. F5b implements
the client against this document with a mock adapter; F5a builds the endpoints
(`odd/tasks/fase3-operacion.md`, F5a). Types live in
`desktop/app/src/api/contract.ts`; change both together.

## Basics

- Base URL: `https://<api>`, the same origin as VIPE web (the API is under `/api`).
- Device auth: after pairing, every call sends `Authorization: Bearer <deviceToken>`
  (`vdt_…`). The API stores only its sha256, like printer tokens today. A
  revoked token answers `401 {code: "device_revoked"}`; the app then shows
  "Vincular de nuevo".
- Errors: `{ "message": "<Spanish text for the user>", "code": "<snake_case>" }`.
- Times: ISO 8601 with offset. Money: integer pesos.
- Routing is decided by the server (L10): the desktop never chooses which dish
  goes where; it maps a job's `station` to the local printers assigned to it.

## 1. Pairing

An admin opens **VIPE web → Ajustes → Estación de impresión → Generar código**
(`POST /api/desktop/pairing-codes`, admin only) and gets
`{ code: "481207", expiresAt }`, valid 10 minutes, single use.

### `POST /api/desktop/pairing/preview`

Request `{ "code": "481207" }` (6 digits). Shows which restaurant the code
belongs to before claiming it ("¿Es tu restaurante?").

| Status | Body |
|---|---|
| 200 | `{ restaurant: { id, name, branch, address, initials } }` |
| 404 | `{ code: "pairing_code_invalid" }` |
| 410 | `{ code: "pairing_code_expired" }` |
| 429 | `{ code: "pairing_attempts" }` (5 wrong codes per IP in 10 minutes) |

### `POST /api/desktop/pairing/claim`

Request `{ code, device: { name, platform: "windows", appVersion } }`.
201 `{ deviceId, deviceToken, restaurant, channel: "stable" | "pilot" }`.
Same errors as preview; a claimed code answers 410.

## 2. Heartbeat

`POST /api/desktop/heartbeat` every 30 s:
`{ appVersion, printers: [{ id, status: "ready" | "printing" | "error" | "offline", error? }], queue: { pending, failed } }`
→ 200 `{ serverTime, channel, printingEnabled }`. `printingEnabled = false`
(restaurant setting, S2) stops the queue and the panel says printing is off.

## 3. Stations (read-only)

`GET /api/desktop/stations` →
`[{ id, name, kind: "cashier" | "kitchen" | "bar" | "other", fixed, prints: "Entradas, Platos fuertes, Postres", productCount }]`.
`fixed` is the Caja station (facturas, precuentas, cierre). `prints` is the
read-only "Qué imprime" text built by the server from F6's routes.

## 4. Printers registry

`PUT /api/desktop/printers` with the full local list
`[{ id, name, model, connection: "usb" | "network" | "bluetooth", paperMm: 58 | 80, hasDrawer, stationIds }]`
→ 200 the stored list. Only metadata: addresses and Windows printer names stay
on the computer.

## 5. Print jobs

- `GET /api/desktop/jobs/pending?after=<jobId>&limit=500` →
  `[{ id, kind: "command" | "invoice", station, createdAt, payload }]`, oldest
  first, for the stations this device's printers serve. Payloads are today's
  `print_job` payloads (see `pos/print_jobs.py`): `command`
  `{ invoiceNumber, items, waiter, table?, delivery? }`, `invoice`
  `{ invoiceNumber, invoice, displayItems }`. One job per station: a printer
  serving two stations gets two jobs (L10).
- A socket.io `print_job` event with the same shape may push jobs sooner; the
  device dedupes by `id`.
- `POST /api/desktop/jobs/{id}/ack` `{ status: "printed" | "skipped" | "cancelled", reason? }`
  → 204, idempotent. Acked jobs stop being pending. `skipped` covers
  unprintable payloads and comandas older than 12 hours.

## 6. Cash drawer

`POST /api/desktop/drawer-events` `{ printerId, openedAt, reason: "manual" | "cash_payment", profileId? }`
→ 204. "Abrir cajón" opens at once and records the event (L10).

## 7. Updates (L26)

Tauri updater endpoint, per restaurant channel (Piloto receives versions a week
before Estable), served from VIPE storage:

`GET https://<api>/api/desktop/updates/{{target}}/{{current_version}}`
(device token as Bearer). 204 when up to date, else 200
`{ version, notes, pub_date, url, signature }` (Tauri dynamic manifest; the
signature is checked with `desktop/signing/updater.key.pub`). The app downloads
in the background and installs only out of service: no job waiting or printing
and no print in the last 10 minutes, or at the next start.
