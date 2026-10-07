# Delta for Printer Listener Reliability (P5)

## Purpose

Make the Windows printer listener reproducible via `requirements.txt` with pinned versions; authenticate the Realtime connection with a service-role token; prevent duplicate prints via LRU dedupe; negotiate encoding; share print renderer between web and Python.

## ADDED Requirements

### Requirement: R5-01 — `pos/requirements.txt` Pinned

`pos/requirements.txt` MUST exist with pinned versions for all runtime dependencies: `customtkinter`, `pystray`, `Pillow`, `html2text`, `escpos-python`, `pywin32`, `usb`, `realtime`, `python-dotenv`.

Running `pip install -r pos/requirements.txt` MUST complete without ImportError.

#### Scenario: S5-01 — Requirements file enables reproducible env

- GIVEN a developer on Windows with Python 3.11 runs `pip install -r pos/requirements.txt`
- WHEN `python -c "import customtkinter, pystray, PIL, html2text, escpos, win32crypt, usb"` is executed
- THEN all imports succeed
- AND `pos/app.py` can be started without import errors

### Requirement: R5-02 — Printer Listener Authenticates

`pos/app.py` MUST authenticate to Supabase Realtime using a service-role token (or a dedicated GoTrue user) rather than the anon key.

`docker-compose.yml` `ANONYMOUS_USERS_ENABLED: "false"` MUST remain in effect; the listener MUST use a JWT that passes RLS for the `room_commands` and `room_bills` broadcast channels.

#### Scenario: S5-02 — Service-role token passes Realtime auth

- GIVEN `ANONYMOUS_USERS_ENABLED: "false"` is set in docker-compose
- WHEN `pos/app.py` connects with a service-role JWT
- THEN the `AsyncRealtimeClient` successfully subscribes to `room_commands` and `room_bills`
- AND messages are received on those channels

#### Scenario: S5-03 — Anon key rejected by local stack

- GIVEN `ANONYMOUS_USERS_ENABLED: "false"`
- WHEN `pos/app.py` connects with the anon key
- THEN the Realtime connection is rejected or receives no events
- AND a log entry records the auth failure

### Requirement: R5-03 — No Duplicate Prints Within 30 Seconds

`pos/app.py` MUST maintain a short-lived LRU cache (max 100 entries, TTL 30 s) keyed by `invoiceNumber`.

If a broadcast message with the same `invoiceNumber` arrives within 30 s of a previous print, the second print MUST be skipped.

#### Scenario: S5-04 — Duplicate broadcast does not re-print

- GIVEN `invoiceNumber = "INV-001"` was printed at T=0
- WHEN the same broadcast is re-delivered at T=15 (network retry)
- THEN the printer does not print INV-001 again
- AND the LRU cache entry for INV-001 is still present

#### Scenario: S5-05 — After TTL, same invoice can print again

- GIVEN `invoiceNumber = "INV-002"` was printed at T=0
- WHEN 31 seconds elapse and a new `room_bills` broadcast arrives for `INV-002`
- THEN the printer prints `INV-002` again
- AND the LRU cache has been evicted and refreshed

### Requirement: R5-04 — Encoding Negotiated at Startup

`pos/app.py` MUST attempt to negotiate UTF-8 with the ESC/POS printer at startup; if the printer rejects or NAKs, fall back to CP1252.

The negotiated encoding MUST be logged.

#### Scenario: S5-06 — UTF-8 used when printer supports it

- GIVEN the ESC/POS printer supports UTF-8
- WHEN `pos/app.py` initializes the printer connection
- THEN the printer is set to UTF-8 mode
- AND a log entry reads "Encoding: UTF-8"

#### Scenario: S5-07 — Spanish chars survive encoding

- GIVEN a dish named "Ñoquis con Salsa BBQ" is in the order payload
- WHEN the order is printed
- THEN the receipt shows "Ñoquis con Salsa BBQ" correctly
- AND no `?` replacement characters appear

### Requirement: R5-05 — Print Components Share Renderer

`components/printing/KitchenOrderPrintView.tsx` and `InvoicePrintView.tsx` MUST use a shared print-renderer utility in `lib/print/` that is also importable by `pos/app.py`.

The print renderer MUST NOT depend on React; it MUST produce a plain data structure (HTML string or ESC/POS bytes) that both the web preview and the Python listener can consume.

#### Scenario: S5-08 — Shared renderer produces same output in web and Python

- GIVEN the same order payload is passed to `lib/print/renderKitchenOrder(order)`
- WHEN the output is rendered in the web preview AND encoded by `pos/app.py`
- THEN both outputs represent the same textual content for the kitchen comanda

## MODIFIED Requirements

None — P5 introduces new behavior only.

## NON-FUNCTIONAL REQUIREMENTS

| Aspect | Requirement |
|--------|-------------|
| Reproducibility | `pip install -r pos/requirements.txt` on a clean Windows Python 3.11 env MUST succeed |
| Deduplication | LRU MUST handle up to 100 concurrent `invoiceNumber` entries without memory growth |
| Encoding | Spanish characters MUST NOT be replaced with `?` on any printer that supports CP1252 or UTF-8 |

## MIGRATION / ROLLBACK

- **Migration**: `pos/requirements.txt` creation + `pos/app.py` refactor + `lib/print/` creation
- **Rollback**: `git checkout HEAD~1 -- pos/requirements.txt pos/app.py`; rollback is a redeploy

## OUT OF SCOPE

- RLS / multi-tenant schema (P2)
- Payment atomicity (P3)
- CI / build hardening (P4)
- React Query migration (P6)
- Realtime publication (P1)
