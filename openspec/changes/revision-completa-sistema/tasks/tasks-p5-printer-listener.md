# Tasks: P5 — Printer Listener Reliability

## Phase Goal
Make the Windows printer listener reproducible via `pos/requirements.txt` with pinned versions; authenticate the Realtime connection with a service-role token; prevent duplicate prints via LRU dedupe; negotiate UTF-8/CP1252 encoding; share the print renderer between web preview and Python listener.

## PR Slice Recommendation
- **One PR** (P5). Estimated ~260 changed lines, under the 400-line budget.
- **Branch base**: `main` per `stacked-to-main`. PR branch: `sdd/revision-completa-sistema/p5-printer-listener`.
- P5 is fully independent of P1/P2/P3/P4 — can merge in any order relative to them.

## Tasks

### T5-01 — Create `pos/requirements.txt` with pinned versions
- **description**: New file pinning exact versions: `customtkinter==5.2.2`, `pystray==0.19.5`, `Pillow==10.4.0`, `html2text==2024.2.26`, `escpos-python==1.2.0`, `pywin32==306`, `usb==1.0.2`, `python-dotenv==1.0.1`, `realtime==2.0.2` (matches `from realtime import AsyncRealtimeClient` — the supabase/realtime-py package, NOT the bare `realtime` PyPI package). Add `tenacity==8.2.3` for the reconnect backoff (Q5-B-related improvement but kept simple). Closes HS-11.
- **touches**: [`pos/requirements.txt`]
- **command**: `pip install -r pos/requirements.txt` → success. `python -c "import customtkinter, pystray, PIL, html2text, escpos, win32crypt, usb, realtime, dotenv"` → no ImportError.
- **acceptance_criteria**: [a] `requirements.txt` exists with pinned `==` versions; [b] `pip install` succeeds on Python 3.11; [c] all six runtime imports succeed.
- **depends_on**: []
- **size_lines_estimate**: ~15 lines
- **commit_split_hint**: Single commit: `build(pos): add pinned requirements.txt`.
- **spec_refs**: R5-01 / S5-01.

### T5-02 — Auth refactor: service-role JWT issued dynamically at boot
- **description**: Rewrite `pos/app.py` auth flow: at startup, POST to `http://localhost:54321/auth/v1/admin/users` with a pre-provisioned station email/password (`STATION_EMAIL` + `STATION_PASSWORD` env vars), receive a JWT, use it to initialize `AsyncRealtimeClient(jwt=...)` instead of `SUPABASE_KEY` (the anon key). Background thread rotates the token every 24h. Fixes HS-12. Per Q5-A: dynamic issuance + 24h rotation.
- **touches**: [`pos/app.py`]
- **command**: With `ANONYMOUS_USERS_ENABLED: "false"` in docker-compose: `python pos/app.py` connects → log shows `Realtime subscribed with service-role JWT`. Then revert to anon key → log shows `auth rejected`.
- **acceptance_criteria**: [a] listener authenticates with service-role JWT; [b] anon key path is rejected by local stack; [c] token rotation thread started.
- **depends_on**: [T5-01]
- **size_lines_estimate**: ~80 lines
- **commit_split_hint**: Single commit: `feat(pos): authenticate realtime with service-role JWT + 24h rotation`.
- **spec_refs**: R5-02 / S5-02, S5-03.

### T5-03 — LRU dedupe cache (max 256, TTL 30s)
- **description**: Add `pos/dedupe.py` with `RecentlyPrintedCache` class using `OrderedDict` (maxsize=256, ttl_seconds=30). `should_print(invoice_number) -> bool` returns False on a hit (skips print). Wire into `pos/app.py` `handle_comanda` and `handle_bill` — wrap the print call. Fixes HS-26.
- **touches**: [`pos/dedupe.py`, `pos/app.py`]
- **command**: Unit test: feed `INV-001` twice within 30s → only one print. Wait 31s → next `INV-001` prints. (Or document the manual reproduction in `docs/printer-dedupe-test.md` if pytest isn't installed per `strict_tdd: false`.)
- **acceptance_criteria**: [a] duplicate broadcast within 30s does NOT print; [b] after 30s TTL, re-print allowed; [c] cache evicts oldest when size > 256.
- **depends_on**: [T5-01]
- **size_lines_estimate**: ~40 lines
- **commit_split_hint**: Single commit: `feat(pos): LRU dedupe for invoice numbers`.
- **spec_refs**: R5-03 / S5-04, S5-05.

### T5-04 — UTF-8 encoding negotiation with CP1252 fallback
- **description**: Replace `pos/app.py:474` hard-coded `text.encode('cp1252', errors='replace')` with a `negotiate_encoding(printer)` helper that tries UTF-8 first, falls back to CP1252 if the printer NAKs or the active code page is in (437, 850, 858). Logs the negotiated encoding. Fixes HS-27.
- **touches**: [`pos/app.py`]
- **command**: With a UTF-8-capable printer: `python pos/app.py` → log shows `Encoding: UTF-8`. With an older printer → log shows `Encoding: CP1252 (fallback)`. Print "Ñoquis con Salsa BBQ" → receipt shows the accented characters correctly.
- **acceptance_criteria**: [a] UTF-8 used when supported; [b] CP1252 fallback works; [c] Spanish chars (Ñ, accents) print without `?` replacement.
- **depends_on**: [T5-01]
- **size_lines_estimate**: ~25 lines
- **commit_split_hint**: Single commit: `feat(pos): negotiate UTF-8 encoding with CP1252 fallback`.
- **spec_refs**: R5-04 / S5-06, S5-07.

### T5-05 — Shared print renderer between web and Python
- **description**: Create `lib/print/renderKitchenOrder.ts` (TypeScript) that produces a `PrintLine[]` data structure (no React, no DOM). Update `components/printing/KitchenOrderPrintView.tsx` and `InvoicePrintView.tsx` to import from `lib/print/`. Create `pos/print_renderer.py` with the equivalent Python implementation consuming the same payload structure. Both produce equivalent textual output for the same order. Fixes HS-28 and closes the divergence root cause.
- **touches**: [`lib/print/renderKitchenOrder.ts`, `pos/print_renderer.py`, `components/printing/KitchenOrderPrintView.tsx`, `components/printing/InvoicePrintView.tsx`]
- **command**: Pass the same order payload to the TS renderer (web preview) and the Python renderer → byte-stream for the same dish names and quantities. Visual diff against a sample order in `docs/print-renderer-fixture.md`.
- **acceptance_criteria**: [a] both renderers produce the same textual content for the same input; [b] web preview component no longer hand-rolls ESC/POS bytes; [c] Python side imports from `print_renderer` instead of inlining.
- **depends_on**: []
- **size_lines_estimate**: ~70 lines
- **commit_split_hint**: Single commit: `feat(print): shared renderer for kitchen + invoice (TS + Python)`.
- **spec_refs**: R5-05 / S5-08.

### T5-06 — Update `pos/README.md` with reproducible install + driver guidance
- **description**: Rewrite `pos/README.md`: document `pip install -r pos/requirements.txt`, the WinUSB / libusb-win32 driver installer (currently missing from `vipe_pos_installer.iss`), the `--hidden-import` flags for PyInstaller (`win32crypt`, `pywintypes`), and the env vars (`STATION_EMAIL`, `STATION_PASSWORD`, `SUPABASE_URL`).
- **touches**: [`pos/README.md`]
- **command**: `grep "STATION_EMAIL\|STATION_PASSWORD\|requirements.txt" pos/README.md` → matches.
- **acceptance_criteria**: [a] install + driver steps documented; [b] env vars listed; [c] PyInstaller flags listed.
- **depends_on**: [T5-01, T5-02]
- **size_lines_estimate**: ~50 lines
- **commit_split_hint**: Single commit: `docs(pos): install + driver + PyInstaller flags`.
- **spec_refs**: — (closes HS-11 documentation gap).

### T5-07 — Phase verification smoke harness
- **description**: Add `pnpm verify:p5` that runs `pip install -r pos/requirements.txt --dry-run` (CI uses Python 3.11 via `actions/setup-python@v5`). Documents a manual Windows-only test recipe in `docs/printer-listener-test.md`.
- **touches**: [`package.json`, `docs/printer-listener-test.md`]
- **command**: `pnpm verify:p5`.
- **acceptance_criteria**: [a] pip dry-run resolves all deps; [b] manual test recipe covers: connect with anon → reject; connect with service-role → success; duplicate broadcast → no re-print.
- **depends_on**: [T5-01, T5-02, T5-03, T5-04, T5-05, T5-06]
- **size_lines_estimate**: ~25 lines
- **commit_split_hint**: Single commit: `chore(verify): add p5 printer smoke harness`.
- **spec_refs**: R5-01, R5-02, R5-03 / S5-01, S5-02, S5-04.

## Verification (apply agent will run)
```
pip install -r pos/requirements.txt --dry-run
pnpm verify:p5
# Manual Windows-only: docs/printer-listener-test.md
```

## Known environmental failures
- `python` and `pip` may not be on PATH on macOS/Linux CI — the `pos-deps-check` job in `.github/workflows/ci.yml` (added in P4) is optional and gated.
- `pos/app.py` cannot be exercised end-to-end without a real ESC/POS printer; T5-04 verification is best-effort.

## Rollback Plan
1. `git revert <merge-sha>` — reverts `requirements.txt` + `app.py` + new files in one commit.
2. Surgical: `git checkout HEAD~1 -- pos/requirements.txt pos/app.py`; remove new files.

## Out-of-phase items
- Persistent offline queue (SQLite) for the printer listener (HS-12 partial, deferred per Q5-B).
- Replacing DPAPI credential storage with OS keychain (HS-12 left in place per deferred list).
- Shipping the WinUSB driver installer as an Inno Setup optional step (T5-06 documents it but does not modify `vipe_pos_installer.iss`).
- `pos/` migration to pnpm workspaces (deferred per proposal).
