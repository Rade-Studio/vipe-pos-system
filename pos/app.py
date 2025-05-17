import os, sys
import threading
from datetime import datetime

from realtime import AsyncRealtimeClient
from escpos.printer import Usb, Network
from PIL import Image
import pystray
import asyncio
import html2text
import sys
import usb.core
from tkinter import simpledialog
import customtkinter as ctk
import queue
from pathlib import Path

ctk.set_appearance_mode("System")  # opcional, ajusta el tema al sistema
root = ctk.CTk()                   # creas el root de CTk
root.withdraw()                    # lo ocultas inmediatamente

# Variables y funciones comunes
SUPABASE_URL = None
SUPABASE_KEY = None
CONFIG_DIR = None
CONFIG_FILE = None

def encrypt_blob(plaintext: str) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("Solo Windows es soportado para producción")
    import win32crypt
    return win32crypt.CryptProtectData(plaintext.encode("utf-8"), None, None, None, None, 0)

def decrypt_blob(blob: bytes) -> str:
    if sys.platform != "win32":
        raise RuntimeError("Solo Windows es soportado para producción")
    import win32crypt
    desc, data = win32crypt.CryptUnprotectData(blob, None, None, None, 0)
    return data.decode("utf-8")

def load_credentials():
    if not CONFIG_FILE or not CONFIG_FILE.exists():
        return None, None
    blob = CONFIG_FILE.read_bytes()
    txt = decrypt_blob(blob)
    url, key = txt.split("|", 1)
    return url, key

def save_credentials(url: str, key: str):
    if not CONFIG_DIR:
        raise RuntimeError("CONFIG_DIR no está definido")
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    blob = encrypt_blob(f"{url}|{key}")
    CONFIG_FILE.write_bytes(blob)

# -----------------
# Detectar entorno
# -----------------
ENVIRONMENT = os.getenv("ENVIRONMENT", "production").lower()
if "--dev" in sys.argv:
    ENVIRONMENT = "dev"

if ENVIRONMENT == "dev":
    from dotenv import load_dotenv
    print("🛠️  Ambiente de Desarrollo Detectado (usando .env)")
    dotenv_path = Path(__file__).parent / ".env"
    load_dotenv(dotenv_path)

    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY")

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Faltan SUPABASE_URL o SUPABASE_KEY en el archivo .env")

else:
    print("🚀 Ambiente de Producción Detectado (AppData cifrado)")
    CONFIG_DIR = Path(os.getenv("APPDATA", os.path.expanduser("~"))) / "VipePOS"
    CONFIG_FILE = CONFIG_DIR / "credentials.dat"

    SUPABASE_URL, SUPABASE_KEY = load_credentials()

    if not SUPABASE_URL or not SUPABASE_KEY:
        dialog = ctk.CTkInputDialog(text="Ingresa tu URL Supabase:", title="Configuración inicial")
        SUPABASE_URL = dialog.get_input().strip() or None

        key_dialog = ctk.CTkInputDialog(text="Ingresa tu API Key Supabase:", title="Configuración inicial")
        SUPABASE_KEY = key_dialog.get_input().strip() or None

        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError("Debes ingresar ambas credenciales para continuar.")

        save_credentials(SUPABASE_URL, SUPABASE_KEY)

# Ya puedes usar estas variables globales en cualquier parte
REALTIME_URL = f"{SUPABASE_URL.replace('https', 'wss')}/realtime/v1"

# Impresoras seleccionadas (inicialmente vacías)
selected_printers = {
    'comandas': {'type': 'usb', 'printer': None},
    'facturas': {'type': 'network', 'printer': None}
}

# Almacenamiento temporal para impresoras disponibles
available_printers = []

class PrinterManager:
    def __init__(self):
        self.current_printers = {
            'comandas': None,
            'facturas': None
        }
        self.printer_configs = {
            'comandas': {'type': 'usb', 'details': {}},
            'facturas': {'type': 'network', 'details': {'ip': '192.168.1.2', 'port': 5000}}
        }

    def get_printer(self, printer_type) -> Usb | Network:
        return self.current_printers.get(printer_type)

    def set_usb_printer(self, printer_type, vendor_id, product_id):
        try:
            self.current_printers[printer_type] = Usb(vendor_id, product_id)
            self.printer_configs[printer_type] = {
                'type': 'usb',
                'details': {'vendor_id': vendor_id, 'product_id': product_id}
            }
            print(f"Impresora {printer_type} configurada: USB {vendor_id:04x}:{product_id:04x}")
            return True
        except Exception as e:
            print(f"Error al configurar impresora USB: {e}")
            return False

    def set_network_printer(self, printer_type, ip, port=9100):
        try:
            self.current_printers[printer_type] = Network(ip, port=port)
            self.printer_configs[printer_type] = {
                'type': 'network',
                'details': {'ip': ip, 'port': port}
            }
            print(f"Impresora {printer_type} configurada: {ip}:{port}")
            return True
        except Exception as e:
            print(f"Error al configurar impresora de red: {e}")
            return False

    def get_config(self, printer_type):
        return self.printer_configs.get(printer_type, {})

printer_manager = PrinterManager()

def show_network_config(printer_type):
    """
    Lanza create_network_config_dialog en el hilo de GUI via root.after.
    """
    root.after(0, lambda: create_network_config_dialog(printer_type))

def detect_usb_printers():
    """Detecta todas las impresoras USB conectadas"""
    global available_printers
    available_printers = []

    try:
        # Buscar dispositivos USB con clase de impresora
        devices = usb.core.find(find_all=True, bDeviceClass=7)

        for dev in devices:
            try:
                # Obtener información del dispositivo
                vendor_id = dev.idVendor
                product_id = dev.idProduct

                # Intentar acceder a la descripción (requiere permisos)
                dev.set_configuration()
                cfg = dev.get_active_configuration()
                intf = cfg[(0,0)]

                dev_name = usb.util.get_string(dev, 256, intf.iInterface)
                if not dev_name:
                    dev_name = f"Dispositivo USB {vendor_id:04x}:{product_id:04x}"
            except:
                dev_name = f"Dispositivo USB {vendor_id:04x}:{product_id:04x}"

            available_printers.append({
                'vendor_id': vendor_id,
                'product_id': product_id,
                'name': dev_name
            })
    except Exception as e:
        print(f"Error al detectar impresoras: {e}")

    return available_printers

def detect_by_interface_class():
    """Detecta impresoras en dispositivos con clase definida en interfaz"""
    devices = usb.core.find(find_all=True, bDeviceClass=0x00)
    result = []

    for dev in devices:
        for cfg in dev:
            for intf in cfg:
                if intf.bInterfaceClass == 7:
                    result.append(dev)
    return result

def create_network_config_dialog(printer_type):
    """
    Muestra un diálogo CTk con dos campos (IP y puerto), redimensiona
    al tamaño mínimo necesario y lo centra. Devuelve True si guardó.
    """
    global root

    # 1) Valores por defecto
    config       = printer_manager.get_config(printer_type)
    ip_default   = config["details"].get("ip",   "192.168.1.100")
    port_default = config["details"].get("port", 9100)

    result = {"ok": False}

    # 2) Crear Toplevel
    dialog = ctk.CTkToplevel(root)
    dialog.title(f"Configurar impresora de red – {printer_type}")
    dialog.resizable(False, False)

    # 3) Configurar columnas para que la segunda “expanda”
    dialog.grid_columnconfigure(0, weight=0, pad=10)
    dialog.grid_columnconfigure(1, weight=1, pad=10)

    # 4) Widgets
    ctk.CTkLabel(dialog, text="IP de la impresora:")\
        .grid(row=0, column=0, sticky="w", pady=(10,2))
    ip_entry = ctk.CTkEntry(dialog)
    ip_entry.insert(0, ip_default)
    ip_entry.grid(row=0, column=1, sticky="ew", pady=(10,2))

    ctk.CTkLabel(dialog, text="Puerto de la impresora:")\
        .grid(row=1, column=0, sticky="w", pady=2)
    port_entry = ctk.CTkEntry(dialog)
    port_entry.insert(0, str(port_default))
    port_entry.grid(row=1, column=1, sticky="ew", pady=2)

    # 5) Botones
    def on_ok():
        ip_val   = ip_entry.get().strip()
        port_val = port_entry.get().strip()
        if not ip_val:
            print("Debe ingresar una IP válida.")
            return
        try:
            port_int = int(port_val)
        except ValueError:
            print("El puerto debe ser un número entero.")
            return
        success = printer_manager.set_network_printer(printer_type, ip_val, port_int)
        result["ok"] = success
        dialog.destroy()

    def on_cancel():
        dialog.destroy()

    btn_frame = ctk.CTkFrame(dialog)
    btn_frame.grid(row=2, column=0, columnspan=2, pady=10)
    ctk.CTkButton(btn_frame, text="Guardar",  command=on_ok)\
        .grid(row=0, column=0, padx=5)
    ctk.CTkButton(btn_frame, text="Cancelar", command=on_cancel)\
        .grid(row=0, column=1, padx=5)

    # 6) Forzar cálculo de “request size” y aplicar geometría
    dialog.update_idletasks()
    req_w = dialog.winfo_reqwidth()
    req_h = dialog.winfo_reqheight()

    # Centrar
    screen_w = dialog.winfo_screenwidth()
    screen_h = dialog.winfo_screenheight()
    x = (screen_w - req_w) // 2
    y = (screen_h - req_h) // 2

    dialog.geometry(f"{req_w}x{req_h}+{x}+{y}")

    # 7) Modal y espera
    dialog.grab_set()
    dialog.wait_window()

    return result["ok"]

def create_usb_printer_menu(printer_type):
    """Crea un submenú para seleccionar impresora USB"""
    detect_usb_printers()

    if not available_printers:
        return pystray.Menu(
            pystray.MenuItem("No hay impresoras USB", lambda _: None, enabled=False)
        )

    return pystray.Menu(*[
        pystray.MenuItem(
            p['name'],
            lambda _, vid=p['vendor_id'], pid=p['product_id'], pt=printer_type: (
                printer_manager.set_usb_printer(pt, vid, pid)
            )
        ) for p in available_printers
    ])

def init_default_printers():
    """Inicializa impresoras por defecto"""
    # Ejemplo de impresora por defecto
    printer_manager.set_usb_printer('comandas', 0x04b8, 0x0202)
    printer_manager.set_network_printer('facturas', '192.168.1.2', 5000)

def imprimir_html(printer_type, html_str):
    """Imprime HTML usando la impresora seleccionada"""
    printer = printer_manager.get_printer(printer_type)
    if printer and html_str:
        try:
            texto = html2text.html2text(html_str)
            printer.text(texto + "\n")
            printer.cut()
        except Exception as e:
            print(f"Error al imprimir en {printer_type}: {e}")
    else:
        print(f"No hay impresora {printer_type} configurada")

def imprimir_pos(printer_type, text, barcode_data=None, image_path=None):
    """
    Imprime una factura con:
    - Imagen opcional en blanco y negro al inicio
    - Texto con soporte CP1252
    - Código de barras opcional después de un separador
    """
    printer = printer_manager.get_printer(printer_type)
    if printer and text:
        try:
            # Establecer código de página CP1252 (Latin-1)
            printer._raw(b'\x1b\x74\x10')

            # Imprimir imagen si se proporciona
            if image_path:
                try:
                    img = Image.open(image_path).convert('1')  # Convertir a blanco y negro
                    printer.image(img)
                except Exception as img_error:
                    print(f"Error al cargar la imagen: {img_error}")

            # Imprimir el texto
            encoded_text = text.encode('cp1252', errors='replace')
            printer._raw(encoded_text + b'\n')

            # Agregar separador y código de barras si se proporciona
            if barcode_data:
                separator = ('-' * 40 + '\n').encode('cp1252')
                printer._raw(separator)

                # Validar que barcode_data sea string
                barcode_str = str(barcode_data)

                # Eliminar 'pos' si genera conflicto en tu modelo
                printer.barcode(
                    barcode_str,
                    'CODE39',
                    width=2,
                    height=100,
                    font='A'
                )

            # Corte de papel
            printer.cut()

        except Exception as e:
            print(f"Error al imprimir en {printer_type}: {e}")
    else:
        print(f"No hay impresora {printer_type} configurada")

def handle_comanda(payload):
    """Callback para comandas"""
    print(f"payload comanda: {payload}")
    html = payload.get("payload", {}).get("html")
    if html:
        imprimir_html('comandas', html)

def handle_factura(payload):
    """Callback para facturas"""
    data = payload.get("payload", {})
    invoice_number = data.get("invoiceNumber")
    invoice = data.get("invoice")
    display_items = data.get("displayItems")

    if invoice_number:
        text = generate_invoice_pos(invoice_number, invoice, display_items)
        imprimir_pos('facturas', text, barcode_data=123456789)


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
    lines.append(f"FACTURA: {invoice.get('invoiceNumber', 'INV-0001')}")
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

async def iniciar_suscripciones():
    while True:
        try:
            global SUPABASE_KEY, REALTIME_URL
            print("Intentando conectar a Supabase...")
            socket = AsyncRealtimeClient(REALTIME_URL, SUPABASE_KEY)

            # Configurar canales
            ch_comandas = socket.channel("room_comandas")
            ch_facturas = socket.channel("room_facturas")

            # Configurar suscriptores
            ch_comandas.on_broadcast("new_command", handle_comanda)
            ch_facturas.on_broadcast("new_invoice", handle_factura)

            # Callback de suscripción
            def subscription_callback_comandas(status, err):
                if status == "SUBSCRIBED":
                    print(f"✅ Suscrito a canal {ch_comandas.topic}. Iniciando conexión...")
                elif status == "ERROR":
                    raise RuntimeError(f"❌ Error en suscripción: {err}")

            def subscription_callback_facturas(status, err):
                if status == "SUBSCRIBED":
                    print(f"✅ Suscrito a canal {ch_facturas.topic}. Iniciando conexión...")
                elif status == "ERROR":
                    raise RuntimeError(f"❌ Error en suscripción: {err}")


            # Suscribirse a ambos canales
            await ch_comandas.subscribe(subscription_callback_comandas)
            await ch_facturas.subscribe(subscription_callback_facturas)

            # Mantener la conexión activa
            while True:
                await asyncio.sleep(1)

        except Exception as e:
            print(f"❌ Error conectando a Supabase: {e}")

            # Volver a pedir credenciales al usuario
            dialog = ctk.CTkInputDialog(text="Ingresa tu URL Supabase:", title="Reconectar Supabase")
            new_url = dialog.get_input().strip() or None

            key_dialog = ctk.CTkInputDialog(text="Ingresa tu API Key Supabase:", title="Reconectar Supabase")
            new_key = key_dialog.get_input().strip() or None

            if not new_url or not new_key:
                print("⚠️  Credenciales inválidas. Reintentando en 5 segundos...")
                await asyncio.sleep(5)
                continue

            # Guardar las nuevas credenciales cifradas
            save_credentials(new_url, new_key)

            # Actualizar variables globales
            SUPABASE_URL = new_url
            SUPABASE_KEY = new_key
            REALTIME_URL = f"{SUPABASE_URL.replace('https','wss')}/realtime/v1"

            print("🔄 Credenciales actualizadas. Reintentando conexión...")
            await asyncio.sleep(1)

def iniciar_icono_tray():
    # Cargar icono
    try:
        image = Image.open("vipe-pos.ico")
    except FileNotFoundError:
        image = Image.new('RGB', (64, 64), color='blue')

    def refresh_menu(icon):
        icon.menu = create_menu()
        icon.update_menu()

    def create_menu():
        # Opciones de impresoras
        comanda_submenu = pystray.Menu(
            pystray.MenuItem("USB", lambda _ : create_usb_printer_menu('comandas')),
            pystray.MenuItem("Red", lambda _ : show_network_config('comandas'))
        )

        factura_submenu = pystray.Menu(
            pystray.MenuItem("USB", lambda _ : create_usb_printer_menu('facturas')),
            pystray.MenuItem("Red", lambda _ : show_network_config('facturas'))
        )

        # Información de impresoras actuales
        comanda_info = get_printer_info('comandas')
        factura_info = get_printer_info('facturas')

        return pystray.Menu(
            pystray.MenuItem(
                f"Comandera: {comanda_info}",
                comanda_submenu
            ),
            pystray.MenuItem(
                f"Facturas: {factura_info}",
                factura_submenu
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Escanear impresoras",
                lambda icon, item: refresh_menu(icon)
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Salir", lambda icon, item: exit_app(icon))
        )

    def get_printer_info(printer_type):
        config = printer_manager.get_config(printer_type)
        if config['type'] == 'usb':
            details = config['details']
            return f"USB {details.get('vendor_id', '---')}:{details.get('product_id', '---')}"
        elif config['type'] == 'network':
            details = config['details']
            return f"Red {details.get('ip', '---')}:{details.get('port', '---')}"
        return "Sin configurar"

    def exit_app(icon):
        icon.stop()
        sys.exit()

    # Crear icono inicial
    icon = pystray.Icon("Comandera", image, menu=create_menu())
    icon.run()

if __name__ == "__main__":
    # --- Inicializa root oculto de CTk (como ya lo tienes) ---
    # ctk.set_appearance_mode("System")
    # root = ctk.CTk()
    # root.withdraw()

    # Iniciar impresoras por defecto
    init_default_printers()

    # Iniciar suscripciones de Supabase en un hilo
    loop = asyncio.new_event_loop()
    threading.Thread(
        target=loop.run_until_complete,
        args=(iniciar_suscripciones(),),
        daemon=True
    ).start()

    # *** Levanta el icono de bandeja en un hilo secundario ***
    threading.Thread(
        target=iniciar_icono_tray,
        daemon=True
    ).start()

    # *** Arranca el bucle de eventos de CustomTkinter en el hilo principal ***
    root.mainloop()
