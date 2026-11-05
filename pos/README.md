# VipePOS Printer Listener

Windows-only Python app that receives kitchen commandas and invoices from the VIPE API (socket.io `print_job` events plus a pending-jobs fetch on every connect) and prints them on ESC/POS thermal printers. The main README section "Servicio de impresión" describes the flow.

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
python -c "import customtkinter, pystray, PIL, html2text, escpos, win32crypt, usb, socketio, aiohttp, dotenv"
```

### 4. Configure environment variables

Create `pos/.env` (for `--dev` mode):

```env
VIPE_API_URL=http://localhost:4000
VIPE_PRINTER_TOKEN=vpt_dev-printer-token-2026
```

The token above is the one `pnpm db:dev` seeds. For a real restaurant an admin
creates one token per station in **Administración > Configuración > Impresoras**
(the token is shown once; the same screen revokes it). The API equivalent is
`POST /api/devices/printers {name}`. Production setup, including the reverse-proxy
requirements for `/socket.io/` and `/api/print/*`, is in `docs/despliegue.md`.

> **Production**: the first run asks for the API URL and the printer token and
> stores both DPAPI-encrypted in `%APPDATA%\VipePOS\printer_credentials.dat`.

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
| `VIPE_API_URL`       | Yes (dev) | API base URL, e.g. `http://localhost:4000`. Production: first-run dialog. |
| `VIPE_PRINTER_TOKEN` | Yes (dev) | Printer token (`vpt_...`) bound to one restaurant. Production: first-run dialog. |
| `ENVIRONMENT`        | No       | `production` (default) or `dev`. `--dev` flag overrides. |

---

## Architecture Notes

- **Auth**: a printer token sent as `auth: {token}` in the socket.io handshake (namespace
  `/realtime`) and as `Authorization: Bearer` on `/api/print/jobs/*`. The API joins the socket
  to `printers:<restaurantId>` only; a revoked token is refused and its sockets dropped.
- **Durable jobs**: `pos/print_jobs.py` prints each job and tells `app.py` whether to ack it
  (`POST /api/print/jobs/<id>/ack`, idempotent). Without a configured printer or on a printer
  error the job stays pending and is retried on the next connect.
- **Deduplication**: by job id (one-day cache in `pos/dedupe.py`), so a job delivered by the
  socket and by the pending fetch prints once, while a reprint (a new job) prints again.
- **Encoding**: `pos/print_encoder.py` negotiates UTF-8 at startup; falls back to CP1252
  for legacy firmware (code pages 437, 850, 858).
- **Shared renderer**: `pos/print_renderer.py` produces the same ESC/POS byte stream as the
  web preview in `lib/print/renderKitchenOrder.ts`.

---

## Multi-tender payment breakdown (tarea 10b)

A partir de la tarea 10a el web envía, además del campo `paymentMethod`
tradicional, un arreglo `tenders` con cada línea de pago
(`methodCode`, `methodName`, `methodKind: 'cash'|'electronic'`,
`amount`, `cashReceived?`) y un campo `change` con el cambio total.

Cuando el payload incluye `tenders` no vacío, el ticket imprime:

```
FORMAS DE PAGO:
NEQUI          30.000
EFECTIVO       17.000
  RECIBIDO  20.000 / CAMBIO   3.000
CAMBIO: 3.000
```

Si la línea de pago es en efectivo y el cliente entregó más del valor
de esa línea (`cashReceived > amount`), se imprime la sub-línea
indentada `RECIBIDO … / CAMBIO …`. Si el total de cambio (`change`) es
mayor a cero se agrega además una línea final `CAMBIO: …`.

Si el payload no incluye `tenders` (facturas antiguas, reimpresiones
previas a 10a), se mantiene el bloque legacy sin cambios:

```
FORMA DE PAGO: <etiqueta>
RECIBIDO: …
CAMBIO: …
```

### Importante: reinstalar el listener

El listener de Windows es un `.exe` empaquetado con PyInstaller. Los
listeners ya instalados en los restaurantes **siguen imprimiendo el
bloque legacy** (una sola línea `FORMA DE PAGO:`) aunque el web envíe el
nuevo payload, porque su `print_renderer.py` no conoce todavía la rama
de `tenders`. Para que el desglose por forma de pago se imprima, hay
que **reconstruir y reinstalar el `.exe`** con la versión actualizada
del renderer. Hasta que eso pase, los tickets siguen funcionando igual
que antes (el payload nuevo es aditivo: el campo `tenders` simplemente
se ignora).

### Pruebas

Las pruebas de regresión del renderer viven en
`pos/test_print_renderer.py` (stdlib `unittest`, sin dependencias
nuevas). Cubren tanto el bloque legacy (con snapshots byte-exactos
capturados antes del cambio) como la nueva ruta de `tenders` y la
caída al bloque legacy ante un payload malformado.

```bash
# Desde la raíz del repo
python3 -m unittest pos.test_print_renderer

# O desde la carpeta pos/
cd pos && python3 -m unittest test_print_renderer
```
