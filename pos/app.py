import os
import threading

from dotenv import load_dotenv
from supabase import create_client
from realtime import AsyncRealtimeClient
from escpos.printer import Usb, Network
from PIL import Image
import pystray
import asyncio
import html2text
import sys
import usb.core
import tkinter as tk
from tkinter import simpledialog

# === CONFIGURACIÓN INICIAL ===
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
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

    def get_printer(self, printer_type):
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
    """Crea un diálogo para configurar impresora de red"""
    root = tk.Tk()
    root.withdraw()  # Ocultar ventana principal

    ip = simpledialog.askstring(
        f"Configurar impresora de red - {printer_type}",
        "Ingrese la IP de la impresora:",
        initialvalue=printer_manager.get_config(printer_type)['details'].get('ip', '192.168.1.100')
    )

    if ip:
        port = simpledialog.askinteger(
            f"Configurar impresora de red - {printer_type}",
            "Ingrese el puerto (por defecto 9100):",
            initialvalue=printer_manager.get_config(printer_type)['details'].get('port', 9100),
            minvalue=1,
            maxvalue=65535
        )

        if port:
            return printer_manager.set_network_printer(printer_type, ip, port)

    return False

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
            toast.warning(f"No se pudo imprimir en {printer_type}")
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
    print(f"payload factura: {payload}")
    html = payload.get("payload", {}).get("html")
    if html:
        imprimir_html('facturas', html)

async def iniciar_suscripciones():
    socket = AsyncRealtimeClient(REALTIME_URL, SUPABASE_KEY)

    # Configurar canales
    ch_comandas = socket.channel("room_comandas")
    ch_facturas = socket.channel("room_facturas")

    # Configurar suscriptores
    ch_comandas.on_broadcast("new_command", handle_comanda)
    ch_facturas.on_broadcast("new_invoice", handle_factura)

    # Callback de suscripción
    def subscription_callback(status, err):
        if status == "SUBSCRIBED":
            print(f"Suscrito a canal {ch_comandas.topic}")
        elif status == "ERROR":
            print(f"Error en suscripción: {err}")

    # Suscribirse a ambos canales
    await ch_comandas.subscribe(subscription_callback)
    await ch_facturas.subscribe(subscription_callback)

    # Mantener la conexión activa
    while True:
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
            pystray.MenuItem("USB", lambda _: (
                create_usb_printer_menu('comandas')
            )),
            pystray.MenuItem("Red", lambda _: (
                create_network_config_dialog('comandas')
            ))
        )

        factura_submenu = pystray.Menu(
            pystray.MenuItem("USB", lambda _: (
                create_usb_printer_menu('facturas')
            )),
            pystray.MenuItem("Red", lambda _: (
                create_network_config_dialog('facturas')
            ))
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
    # Iniciar impresoras por defecto
    init_default_printers()

    # Iniciar hilos
    loop = asyncio.new_event_loop()
    threading.Thread(
        target=loop.run_until_complete,
        args=(iniciar_suscripciones(),),
        daemon=True
    ).start()

    iniciar_icono_tray()
