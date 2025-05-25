import os
import sys
import threading
import asyncio
import json
import re
import ctypes

from datetime import datetime
from pathlib import Path
from tkinter import messagebox

import usb.core
import customtkinter as ctk
import html2text
from escpos.printer import Usb, Network
from PIL import Image
import pystray
from realtime import AsyncRealtimeClient  # Asegúrate de que este import funcione

# ------------------------
# RUTAS Y CONSTANTES
# ------------------------
ICON_PATH = str(Path(__file__).parent / "vipe-pos.ico")
APPDATA = os.getenv("APPDATA", os.path.expanduser("~"))
PRINTERS_CONFIG_DIR  = Path(APPDATA) / "VipePOS"
PRINTERS_CONFIG_FILE = PRINTERS_CONFIG_DIR / "printers_config.json"

# Tema de CustomTkinter
BG_COLOR     = "#22232d"
CARD_BORDER  = "#8A2BE2"
ENTRY_BG     = "#333333"
ENTRY_BORDER = "#6A0DAD"
BUTTON_BG    = "#6A0DAD"
BUTTON_HOVER = "#8A2BE2"
BUTTON_TEXT  = "#FFFFFF"
LABEL_TEXT   = "#FFFFFF"

# ------------------------
# WIDGETS ESTILIZADOS
# ------------------------

ctk.set_appearance_mode("System")
root = ctk.CTk()
root.iconbitmap(ICON_PATH)
root.withdraw()

def ThemedLabel(parent, **kwargs):
    return ctk.CTkLabel(parent, text_color=LABEL_TEXT, **kwargs)

def ThemedEntry(parent, **kwargs):
    return ctk.CTkEntry(parent,
                        fg_color=ENTRY_BG,
                        border_color=ENTRY_BORDER,
                        text_color=LABEL_TEXT,
                        **kwargs)

def ThemedButton(parent, **kwargs):
    return ctk.CTkButton(parent,
                         fg_color=BUTTON_BG,
                         hover_color=BUTTON_HOVER,
                         text_color=BUTTON_TEXT,
                         **kwargs)

def ThemedFrame(parent, **kwargs):
    return ctk.CTkFrame(parent,
                        fg_color=BG_COLOR,
                        border_color=CARD_BORDER,
                        **kwargs)

def center_window(win):
    win.update_idletasks()
    w, h = win.winfo_reqwidth(), win.winfo_reqheight()
    sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
    win.geometry(f"{w}x{h}+{(sw-w)//2}+{(sh-h)//2}")

def styled_toplevel(title: str):
    dlg = ctk.CTkToplevel(root)
    dlg.title(title)
    dlg.iconbitmap(ICON_PATH)
    dlg.configure(fg_color=BG_COLOR)
    return dlg


# ------------------------
# CONFIG / CREDENCIALES
# ------------------------
CONFIG_DIR  = None
CONFIG_FILE = None
SUPABASE_URL = None
SUPABASE_KEY = None

def encrypt_blob(plaintext: str) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("Solo Windows soportado para producción")
    import win32crypt
    return win32crypt.CryptProtectData(plaintext.encode("utf-8"), None, None, None, None, 0)

def decrypt_blob(blob: bytes) -> str:
    if sys.platform != "win32":
        raise RuntimeError("Solo Windows soportado para producción")
    import win32crypt
    desc, data = win32crypt.CryptUnprotectData(blob, None, None, None, 0)
    return data.decode("utf-8")

def load_credentials():
    """Carga URL y KEY Supabase cifradas."""
    global CONFIG_DIR, CONFIG_FILE
    if not CONFIG_FILE or not CONFIG_FILE.exists():
        return None, None
    blob = CONFIG_FILE.read_bytes()
    url, key = decrypt_blob(blob).split("|",1)
    return url, key

def save_credentials(url: str, key: str):
    """Guarda URL y KEY Supabase cifradas."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    blob = encrypt_blob(f"{url}|{key}")
    CONFIG_FILE.write_bytes(blob)

def ask_supabase_url():
    dlg = styled_toplevel("Configurar Supabase URL")
    ThemedLabel(dlg, text="URL Supabase:").pack(padx=20, pady=(20,5), anchor="w")
    entry = ThemedEntry(dlg, width=300); entry.pack(padx=20, pady=(0,20))
    btn_frame = ThemedFrame(dlg); btn_frame.pack(pady=(0,20))
    result = {"url": None}
    ThemedButton(btn_frame, text="Guardar", width=120,
                 command=lambda: (result.update(url=entry.get().strip()), dlg.destroy())
    ).grid(row=0, column=0, padx=10)
    ThemedButton(btn_frame, text="Cancelar", width=120,
                 command=dlg.destroy
    ).grid(row=0, column=1, padx=10)
    center_window(dlg); dlg.grab_set(); dlg.wait_window()
    return result["url"]

def ask_supabase_key():
    dlg = styled_toplevel("Configurar Supabase Key")
    ThemedLabel(dlg, text="API Key Supabase:").pack(padx=20, pady=(20,5), anchor="w")
    entry = ThemedEntry(dlg, width=300, show="*"); entry.pack(padx=20, pady=(0,20))
    btn_frame = ThemedFrame(dlg); btn_frame.pack(pady=(0,20))
    result = {"key": None}
    ThemedButton(btn_frame, text="Guardar", width=120,
                 command=lambda: (result.update(key=entry.get().strip()), dlg.destroy())
    ).grid(row=0, column=0, padx=10)
    ThemedButton(btn_frame, text="Cancelar", width=120,
                 command=dlg.destroy
    ).grid(row=0, column=1, padx=10)
    center_window(dlg); dlg.grab_set(); dlg.wait_window()
    return result["key"]

# Detectar entorno y cargar credenciales
ENVIRONMENT = os.getenv("ENVIRONMENT", "production").lower()
if "--dev" in sys.argv: ENVIRONMENT = "dev"

if ENVIRONMENT == "dev":
    from dotenv import load_dotenv
    print("🛠️  Ambiente de Desarrollo Detectado (usando .env)")
    load_dotenv(Path(__file__).parent / ".env")
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Faltan SUPABASE_URL o SUPABASE_KEY en .env")
else:
    print("🚀 Ambiente de Producción Detectado (AppData cifrado)")
    CONFIG_DIR  = Path(os.getenv("APPDATA", os.path.expanduser("~"))) / "VipePOS"
    CONFIG_FILE = CONFIG_DIR / "credentials.dat"
    SUPABASE_URL, SUPABASE_KEY = load_credentials()
    if not SUPABASE_URL or not SUPABASE_KEY:
        SUPABASE_URL = ask_supabase_url()
        SUPABASE_KEY = ask_supabase_key()
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError("Credenciales Supabase requeridas")
        save_credentials(SUPABASE_URL, SUPABASE_KEY)

# ← Aquí definimos REALTIME_URL YA, tras cargar SUPABASE_URL
REALTIME_URL = f"{SUPABASE_URL.replace('https','wss')}/realtime/v1"

# ------------------------
# PERSISTENCIA DE IMPRESORAS
# ------------------------
def load_printers_config() -> dict:
    """Carga la configuración de impresoras desde JSON, o {} si falla."""
    try:
        if PRINTERS_CONFIG_FILE.exists():
            return json.loads(PRINTERS_CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print("⚠️  Error leyendo printers_config.json:", e)
    return {}

def save_printers_config(cfg: dict):
    """Guarda la configuración de impresoras en JSON."""
    try:
        PRINTERS_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        PRINTERS_CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    except Exception as e:
        print("❌ Error escribiendo printers_config.json:", e)

# ------------------------
# GESTOR DE IMPRESORAS
# ------------------------
class PrinterManager:
    def __init__(self):
        self.current_printers = {'comandas': None, 'facturas': None}
        # Ya no necesitamos mantener un dict local: marginamos al JSON
        # self.printer_configs = {'comandas': {}, 'facturas': {}}

    def get_printer(self, pt):
        return self.current_printers.get(pt)

    def set_usb_printer(self, printer_type, vendor_id, product_id, is_initialized=False):
        try:
            # 1) Configurar la impresora en memoria
            self.current_printers[printer_type] = Usb(vendor_id, product_id)

            # 2) Cargar JSON existente y actualizar solo esta clave
            cfg = load_printers_config()
            cfg[printer_type] = {
                'type': 'usb',
                'vendor_id': vendor_id,
                'product_id': product_id
            }
            save_printers_config(cfg)
            # 3) Mostrar mensaje de éxito
            if not is_initialized:
                messagebox.showinfo("Listo", f"USB {vendor_id:04x}: {product_id:04x} configurada")

            return True
        except Exception as e:
            messagebox.showerror("Error", "No se pudo configurar USB")
            return False

    def set_network_printer(self, printer_type, ip, port, is_initialized=False):
        try:
            self.current_printers[printer_type] = Network(ip, port=port)

            cfg = load_printers_config()
            cfg[printer_type] = {
                'type': 'network',
                'ip': ip,
                'port': port
            }
            save_printers_config(cfg)

            if not is_initialized:
                messagebox.showinfo("Listo", f"Red {ip}: {port} configurada")
            return True
        except Exception as e:
            messagebox.showerror("Error", f"No se pudo configurar Red: {e}")
            return False

    def get_config(self, printer_type):
        # Para mostrar en los diálogos
        return load_printers_config().get(printer_type, {})

printer_manager = PrinterManager()


# Cargamos impresoras guardadas
_saved = load_printers_config()
for printer_type in ("comandas", "facturas"):
    cfg = _saved.get(printer_type)
    if cfg:
        if cfg["type"] == "usb":
            printer_manager.set_usb_printer(printer_type, cfg["vendor_id"], cfg["product_id"], is_initialized=True)
        else:
            printer_manager.set_network_printer(printer_type, cfg["ip"], cfg["port"], is_initialized=True)

# Si no existía config, cargamos valores por defecto
if not _saved:
    printer_manager.set_usb_printer('comandas', 0x04b8, 0x0202, is_initialized=True)
    printer_manager.set_network_printer('facturas', '192.168.1.2', 5000, is_initialized=True)

# ------------------------
# DETECCIÓN USB
# ------------------------
def detect_usb_printers():
    """Detecta impresoras USB conectadas. Devuelve lista vacía si falla."""
    printers = []
    # Intentamos obtener un backend, si está disponible
    try:
        from usb.backend import libusb1
        backend = libusb1.get_backend()
    except ImportError:
        backend = None

    try:
        # Si tenemos backend, lo pasamos; si no, usb.core.find lo ignora
        find_kwargs = {'find_all': True}
        if backend:
            find_kwargs['backend'] = backend

        for dev in usb.core.find(**find_kwargs):
            vid, pid = dev.idVendor, dev.idProduct
            try:
                dev.set_configuration()
                # Intentamos leer el nombre del dispositivo
                name = usb.util.get_string(dev, dev.iProduct) or f"USB {vid:04x}:{pid:04x}"
            except Exception:
                name = f"USB {vid:04x}:{pid:04x}"
            printers.append({
                'vendor_id': vid,
                'product_id': pid,
                'name': name
            })
    except usb.core.NoBackendError:
        print("⚠️ PyUSB: No se encontró backend, detect_usb_printers() -> []")
    except Exception as e:
        print("Error detectando USB:", e)

    return printers

# ------------------------
# DIÁLOGOS
# ------------------------
def show_usb_config_dialog(printer_type):
    if ENVIRONMENT == "dev":
        printers = [
            {'vendor_id': 0x1532, 'product_id': 0x0552, 'name': 'USB de Prueba 1'},
            {'vendor_id': 0x1234, 'product_id': 0x0002, 'name': 'USB de Prueba 2'},
            {'vendor_id': 0x1234, 'product_id': 0x0003, 'name': 'USB de Prueba 3'},
        ]
    else:
        # 2) En PROD, detecto
        printers = detect_usb_printers()
        print("🔌 Impresoras USB detectadas:", printers)
        if not printers:
            messagebox.showinfo("Sin USB", "No se encontraron impresoras USB conectadas.")
            return False

    # 3) Construyo el diálogo con la lista resultante
    dlg = styled_toplevel(f"Seleccionar USB – {printer_type}")
    dlg.geometry("400x300")
    dlg.resizable(False, False)

    ThemedLabel(dlg, text="Elige una impresora USB:")\
        .pack(anchor="w", pady=(10,0), padx=10)

    scroll = ctk.CTkScrollableFrame(
        dlg,
        fg_color=BG_COLOR,
        border_color=CARD_BORDER,
        border_width=1,
        corner_radius=8
    )
    scroll.pack(fill="both", expand=True, padx=10, pady=10)

    for p in printers:
        disp = f"{p['name']}  ({p['vendor_id']:04x}:{p['product_id']:04x})"
        def select_cb(vendor_id=p['vendor_id'], product_id=p['product_id']):
            # 4) Al guardar, solo actualizamos esa impresora
            if printer_manager.set_usb_printer(printer_type, vendor_id, product_id):
                dlg.destroy()
        ThemedButton(
            scroll,
            text=disp,
            width=340,
            anchor="w",
            command=select_cb
        ).pack(fill="x", pady=5, padx=5)

    ThemedButton(dlg, text="Cancelar", width=120, command=dlg.destroy)\
        .pack(pady=(0,10))
    center_window(dlg)
    dlg.grab_set()
    dlg.wait_window()
    return True

def create_network_config_dialog(printer_type):
    cfg = printer_manager.get_config(printer_type)
    ip_def, port_def = cfg.get("ip","192.168.1.100"), cfg.get("port",9100)
    result = {"ok": False}

    dlg = styled_toplevel(f"Configurar red – {printer_type}")
    ThemedLabel(dlg, text="IP:").grid(row=0, column=0, sticky="w", padx=10, pady=(10,2))
    ip_e = ThemedEntry(dlg, width=200); ip_e.grid(row=0, column=1, padx=10, pady=(10,2))
    ip_e.insert(0, ip_def)

    ThemedLabel(dlg, text="Puerto:").grid(row=1, column=0, sticky="w", padx=10, pady=2)
    port_e = ThemedEntry(dlg, width=200); port_e.grid(row=1, column=1, padx=10, pady=2)
    port_e.insert(0, str(port_def))

    frame = ThemedFrame(dlg); frame.grid(row=2, column=0, columnspan=2, pady=10)
    ThemedButton(frame, text="Guardar", width=100,
                 command=lambda: _on_ok_network(printer_type, ip_e, port_e, result, dlg)
    ).grid(row=0, column=0, padx=5)
    ThemedButton(frame, text="Cancelar", width=100, command=dlg.destroy
    ).grid(row=0, column=1, padx=5)

    center_window(dlg); dlg.grab_set(); dlg.wait_window()
    return result["ok"]

def _on_ok_network(pt, ip_e, port_e, result, dlg):
    ip, port = ip_e.get().strip(), port_e.get().strip()
    if not re.match(r"^\d{1,3}(\.\d{1,3}){3}$", ip):
        return messagebox.showerror("IP inválida", "Formato de IP incorrecto.")
    try:
        port_i = int(port)
        if not (1 <= port_i <= 65535): raise ValueError()
    except:
        return messagebox.showerror("Puerto inválido", "Debe ser 1–65535.")
    if printer_manager.set_network_printer(pt, ip, port_i):
        result["ok"] = True
        dlg.destroy()

# ------------------------
# ICONO DE BARRA (tray)
# ------------------------
def iniciar_icono_tray():
    try:
        img = Image.open(ICON_PATH)
    except:
        img = Image.new('RGB', (64,64), color='blue')

    def refresh(icon): icon.menu = create_menu(); icon.update_menu()

    def create_menu():
        return pystray.Menu(
            pystray.MenuItem("Comandera", pystray.Menu(
                pystray.MenuItem("USB", lambda _: show_usb_config_dialog('comandas')),
                pystray.MenuItem("Red", lambda _: root.after(0, lambda: create_network_config_dialog('comandas')))
            )),
            pystray.MenuItem("Facturas", pystray.Menu(
                pystray.MenuItem("USB", lambda _: show_usb_config_dialog('facturas')),
                pystray.MenuItem("Red", lambda _: root.after(0, lambda: create_network_config_dialog('facturas')))
            )),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Escanear", lambda icon,_: refresh(icon)),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Salir", lambda icon,_: (icon.stop(), sys.exit()))
        )

    icon = pystray.Icon("VipePOS", img, menu=create_menu())
    icon.run()

# ------------------------
# SUSCRIPCIONES SUPABASE
# ------------------------
async def iniciar_suscripciones():
    while True:
        try:
            socket = AsyncRealtimeClient(REALTIME_URL, SUPABASE_KEY)
            ch1 = socket.channel("room_comandas"); ch1.on_broadcast("new_command", handle_comanda)
            ch2 = socket.channel("room_facturas"); ch2.on_broadcast("new_invoice", handle_factura)
            await ch1.subscribe(lambda s,e: print("✅ Comandas ok") if s=="SUBSCRIBED" else None)
            await ch2.subscribe(lambda s,e: print("✅ Facturas ok") if s=="SUBSCRIBED" else None)
            while True:
                await asyncio.sleep(1)
        except Exception as e:
            print("❌ Supabase:", e)
            await asyncio.sleep(5)

# ------------------------
# FUNCIONES DE IMPRESIÓN
# ------------------------
def imprimir_html(pt, html_str):
    pr = printer_manager.get_printer(pt)
    if pr and html_str:
        try:
            txt = html2text.html2text(html_str)
            pr.text(txt+"\n"); pr.cut()
        except Exception as e:
            print("Error imprimir HTML:", e)

def imprimir_pos(pt, text, barcode=None, img_path=None):
    pr = printer_manager.get_printer(pt)
    if not pr:
        return print(f"Sin impresora {pt}")
    try:
        pr._raw(b'\x1b\x74\x10')  # CP1252
        if img_path:
            img = Image.open(img_path).convert('1')
            pr.image(img)
        pr._raw(text.encode('cp1252',errors='replace')+b'\n')
        if barcode:
            pr._raw(b'-'*40+b'\n')
            pr.barcode(str(barcode), 'CODE39', width=2, height=100, font='A')
        pr.cut()
    except Exception as e:
        print("Error imprimir POS:", e)

def handle_comanda(payload):
    html = payload.get("payload",{}).get("html")
    if html: imprimir_html('comandas', html)

def handle_factura(payload):
    data = payload.get("payload",{})
    num, inv, items = data.get("invoiceNumber"), data.get("invoice"), data.get("displayItems")
    if num:
        txt = generate_invoice_pos(num, inv, items)
        imprimir_pos('facturas', txt, barcode=123456789)

def generate_invoice_pos(invoice_number, invoice, display_items):
    """Generar factura POS"""
    lines = []
    center = lambda text: text.center(40)

    business = invoice.get('businessInfo', {})
    bill = invoice.get('bill', {})

    # Encabezado
    lines.append(center(""))
    lines.append(center(business.get('name', 'RESTAURANTE').upper()))
    lines.append(center(f"NIT: {business.get('nit', 'N/A')}"))
    lines.append(center(business.get('address', 'N/A')))
    lines.append(center(f"Tel: {business.get('phone', 'N/A')}"))
    lines.append('-' * 40)

    # Información general
    lines.append(f"FACTURA: {invoice.get('invoiceNumber', invoice_number)}")
    lines.append(f"FECHA: {format_date(invoice.get('date', ''))}")
    lines.append(f"MESA: {invoice.get('table', 'N/A')}")
    lines.append(f"MESERO: {invoice.get('waiter', 'N/A')}")
    lines.append('-' * 40)

    # Detalle de productos
    lines.append("CANT DESCRIPCION            IMPORTE")
    for item in display_items:
        name = item.get('name', '')
        quantity = str(item.get('quantity', 1))
        price = format_currency(item.get('price', 0) * item.get('quantity', 1))
        lines.append(f"{quantity:<4} {name:<20.20} {price:>10}")

    lines.append('-' * 40)

    # Totales
    lines.append(f"SUBTOTAL: {format_currency(bill.get('subtotal', 0))}")
    lines.append(f"IVA: {format_currency(bill.get('tax', 0))}")
    if bill.get('totalDiscounts', 0) > 0:
        lines.append(f"DESCUENTOS: -{format_currency(bill.get('totalDiscounts', 0))}")
    lines.append(f"TOTAL SIN PROPINA: {format_currency(bill.get('subtotal', 0) + bill.get('tax', 0))}")
    lines.append(f"PROPINA VOLUNTARIA ({bill.get('tipPercentage', 0)}%): {format_currency(bill.get('tip', 0))}")
    lines.append(f"TOTAL A PAGAR: {format_currency(bill.get('total', 0))}")
    lines.append('-' * 40)

    # Forma de pago
    # debo cambiar metodo de pago, para traducirlo a español con un switch
    payment_method_text = obtener_texto_pago(invoice.get('paymentMethod', 'N/A'))

    payment_method = invoice.get('paymentMethod', 'N/A').capitalize()
    lines.append(f"FORMA DE PAGO: {payment_method_text}")
    if invoice.get('cashReceived', 0) > 0:
        lines.append(f"RECIBIDO: {format_currency(invoice.get('cashReceived', 0))}")
        lines.append(f"CAMBIO: {format_currency(invoice.get('cashChange', 0))}")
    lines.append('-' * 40)

    # Pie de página
    lines.append(center("¡GRACIAS POR SU COMPRA!"))
    lines.append(center("VUELVA PRONTO"))
    lines.append('\n\n\n')

    return "\n".join(lines)

def obtener_texto_pago(payment_method):
    """Obtiene el texto de pago según el método de pago"""
    if payment_method == "cash":
        return "Efectivo"
    elif payment_method == "transfer":
        return "Transferencia"
    elif payment_method == "nequi":
        return "Nequi"
    elif payment_method == "bancolombia":
        return "Bancolombia App"
    else:
        return "N/A"

def format_currency(value):
    """Formatea sin decimales y con separadores de miles"""
    return f"{int(round(value)):,}".replace(",", ".")

def format_date(datetime_string):
    """Formatea fecha y hora en formato dd/mm/yyyy hh:mm:ss"""
    try:
        dt = datetime.fromisoformat(datetime_string)
    except Exception:
        dt = datetime.now()
    return dt.strftime("%d/%m/%Y %H:%M:%S")

# ------------------------
# MAIN
# ------------------------
if __name__ == "__main__":
    # Para que Windows muestre nuestro ícono en la barra de tareas
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("com.miempresa.vipepos")

    # Iniciar Supabase en hilo
    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_until_complete,
                     args=(iniciar_suscripciones(),),
                     daemon=True).start()

    # Iniciar ícono de bandeja
    threading.Thread(target=iniciar_icono_tray, daemon=True).start()

    # Ejecutar GUI
    root.mainloop()
