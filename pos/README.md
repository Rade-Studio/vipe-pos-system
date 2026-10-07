# VipePOS Printer Listener

Windows-only Python app that listens for kitchen commandas and invoices via Supabase Realtime and prints them on ESC/POS thermal printers.

---

## Prerequisites

- Windows 10/11
- Python 3.11+
- ESC/POS compatible thermal printer (e.g., Epson TM-T88, generic 80mm Chinese thermal printer)

---

## Installation

### 1. Clone and enter the project

```bash
git clone <repo-url>
cd vipe-pos-system/pos
```

### 2. Create a virtual environment

```powershell
py -3.11 -m venv venv
.\venv\Scripts\activate
```

### 3. Install dependencies

```powershell
pip install -r requirements.txt
```

> All dependencies are pinned with `==` for reproducibility.  See `requirements.txt` for the version rationale.

Verify the install:

```powershell
python -c "import customtkinter, pystray, PIL, html2text, escpos, win32crypt, usb, realtime, dotenv, tenacity"
```

### 4. Configure environment variables

Create `pos/.env` (for `--dev` mode):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-for-local-dev
VIPE_PRINTER_TOKEN=your-service-role-jwt-token
ENVIRONMENT=dev
```

> **Production**: `VIPE_PRINTER_TOKEN` must be set as a system environment variable.
> The listener resolves it via `os.getenv("VIPE_PRINTER_TOKEN")`.

### 5. Connect printers

Run the app:

```powershell
python app.py --dev
```

Use the system-tray menu to configure USB or network printers for **Comandera** (kitchen) and **Facturas** (invoice).

---

## USB Driver Setup (Windows)

### Option A — WinUSB (recommended for Windows 10+)

For most generic 80mm thermal printers (Zijad, Custom, etc.):

1. Connect the printer via USB.
2. Open **Device Manager** → find the printer under **Other devices** or **USB devices**.
3. Right-click → **Update driver** → **Browse my computer for driver software**.
4. Point to the `pos/drivers/winusb` folder (or download the WinUSB driver from [libwdi](https://github.com/pbatard/libwdi)).

Alternatively, use [Zadig](https://zadig.akeo.ie/) to replace the default driver with WinUSB:

```powershell
# Run Zadig, select the printer device, click "Replace Driver"
```

### Option B — libusbK

For printers that require libusbK:

1. Install [libusbK](https://sourceforge.net/projects/libusbk/) .
2. Use the **USB Device Tree Viewer** to configure the printer's driver assignment.
3. In `vipe_pos_installer.iss`, the Inno Setup script includes an optional libwdi-based driver install step.

### Common Chinese 80mm Thermal Printers (VID/PID)

These are common VID:PID pairs for cheap thermal receipt printers:

| VID    | PID    | Notes                             |
|--------|--------|-----------------------------------|
| 0x04b8 | 0x0202 | Epson TM-T88 compatible           |
| 0x0416 | 0x5011 | Winbond-based generic              |
| 0x0483 | 0x5720 | STMicroelectronics (some printers) |
| 0x1504 | 0x0001 | Pos58 / Zijad generic              |

The app auto-detects USB printers and shows VID:PID in the USB config dialog.

---

## PyInstaller Build

To bundle `app.py` into a Windows executable:

```powershell
py -3.11 -m PyInstaller `
    --onefile `
    --windowed `
    --icon=vipe-pos.ico `
    --name=VipePOS-Listener `
    --add-data "vipe-pos.ico;." `
    --hidden-import=win32crypt `
    --hidden-import=pywintypes `
    --hidden-import=escpos.printer.Usb `
    --hidden-import=escpos.printer.Network `
    --hidden-import=usb.backend.libusb1 `
    app.py
```

Key `--hidden-import` flags:
- `win32crypt` — DPAPI credential encryption (`CryptProtectData`)
- `pywintypes` — required by `win32crypt`
- `escpos.printer.Usb` / `escpos.printer.Network` — ESC/POS USB/Network backends
- `usb.backend.libusb1` — USB backend

---

## Environment Variables

| Variable             | Required | Description                                           |
|----------------------|----------|-------------------------------------------------------|
| `VIPE_PRINTER_TOKEN` | Yes (prod) | Service-role JWT for Realtime auth. Dev: optional; falls back to `SUPABASE_KEY`. |
| `SUPABASE_URL`       | Yes      | e.g. `https://xyz.supabase.co`                        |
| `SUPABASE_KEY`       | Yes (dev) | Anon key for local dev (when `VIPE_PRINTER_TOKEN` not set) |
| `ENVIRONMENT`        | No       | `production` (default) or `dev`. `--dev` flag overrides. |

---

## Architecture Notes

- **Auth**: The listener uses a service-role token (`VIPE_PRINTER_TOKEN`) instead of the anon key.
  `ANONYMOUS_USERS_ENABLED: "false"` in docker-compose rejects anon-key connections.
  Token rotation every 24 h is the follow-up to this slice (Q5-A).
- **Deduplication**: `pos/dedupe.py` maintains an LRU cache (max 256 entries, TTL 30 s) keyed by
  `invoiceNumber`. Duplicate broadcasts within the TTL window are silently skipped.
- **Encoding**: `pos/print_encoder.py` negotiates UTF-8 at startup; falls back to CP1252
  for legacy firmware (code pages 437, 850, 858).
- **Shared renderer**: `pos/print_renderer.py` produces the same ESC/POS byte stream as the
  web preview in `lib/print/renderKitchenOrder.ts`.
