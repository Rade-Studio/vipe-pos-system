# listener.py
import os

from dotenv import load_dotenv
from supabase import create_client
from realtime import AsyncRealtimeClient
from escpos.printer import Usb
from PIL import Image
import pystray
import asyncio
import html2text
import sys
import threading
import usb.core
import usb.util

# === CONFIGURACIÓN ===
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# === CONEXIÓN ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
REALTIME_URL = f"{SUPABASE_URL.replace('https', 'wss')}/realtime/v1"

# Impresoras seleccionadas (inicialmente vacías)
selected_printers = {
    'comandas': None,
    'facturas': None
}

# Almacenamiento temporal para impresoras disponibles
available_printers = []

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

def init_default_printers():
    """Inicializa impresoras por defecto (o deja vacío si no hay impresoras)"""
    global selected_printers

    printers = detect_usb_printers()

    if printers:
        # Si hay impresoras, usar la primera como predeterminada
        default_printer = printers[0]
        try:
            selected_printers['comandas'] = Usb(
                default_printer['vendor_id'],
                default_printer['product_id']
            )
            selected_printers['facturas'] = Usb(
                default_printer['vendor_id'],
                default_printer['product_id']
            )
            print("Impresoras inicializadas por defecto")
        except Exception as e:
            print(f"Error al inicializar impresoras: {e}")
            selected_printers = {'comandas': None, 'facturas': None}
    else:
        # Si no hay impresoras, dejar como None
        selected_printers = {'comandas': None, 'facturas': None}
        print("No se encontraron impresoras USB")

def set_printer(printer_type):
    """Crea una nueva instancia de impresora"""
    def inner(item):
        printer_info = next((p for p in available_printers if p['name'] == item.text), None)
        if printer_info:
            try:
                selected_printers[printer_type] = Usb(
                    printer_info['vendor_id'],
                    printer_info['product_id']
                )
                print(f"Impresora {printer_type} configurada: {printer_info['name']}")
            except Exception as e:
                print(f"Error al configurar impresora: {e}")
        else:
            selected_printers[printer_type] = None
            print(f"Impresora {printer_type} desconfigurada")
    return inner


# === FUNCIÓN PARA IMPRIMIR HTML (convertido a texto) ===
def imprimir_html(html_str):
    texto = html2text.html2text(html_str)
    # printer.text(texto + "\n")
    # printer.cut()

# === CALLBACKS ===
def handle_comanda(payload):
    html_content = payload.get("payload", {}).get("html")

    if html_content:
        try:
            # Guardar el HTML en archivo con codificación UTF-8
            with open("factura.html", "w", encoding="utf-8") as f:
                f.write(html_content)

            print("Archivo factura.html creado con éxito")
            # Descomenta para imprimir después de guardar:
            # imprimir_html(html_content)

        except Exception as e:
            print(f"Error al escribir el archivo: {e}")
    else:
        print("No se encontró contenido HTML en el payload")

def handle_factura(payload):
    print(f"payload completo: {payload}")

    # Acceder al HTML en la estructura correcta del payload
    html_content = payload.get("payload", {}).get("html")

    if html_content:
        try:
            # Guardar el HTML en archivo con codificación UTF-8
            with open("factura.html", "w", encoding="utf-8") as f:
                f.write(html_content)

            print("Archivo factura.html creado con éxito")
            # Descomenta para imprimir después de guardar:
            # imprimir_html(html_content)

        except Exception as e:
            print(f"Error al escribir el archivo: {e}")
    else:
        print("No se encontró contenido HTML en el payload")


# === SUSCRIPCIÓN A TABLAS ===
async def iniciar_suscripciones():
    socket = AsyncRealtimeClient(REALTIME_URL, SUPABASE_KEY)

    # Configurar canales
    ch_comandas = socket.channel("room_comandas")
    ch_facturas = socket.channel("room_facturas")

    # Configurar suscriptores
    ch_comandas.on_broadcast("new_command", handle_comanda)
    ch_facturas.on_broadcast("new_invoice", handle_factura)

    # Definir callback de suscripción
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

# === ICONO DE BANDEJA ===
def iniciar_icono_tray():
    # Cargar icono
    try:
        image = Image.open("vipe-pos.ico")
    except FileNotFoundError:
        # Usar icono por defecto si no existe
        image = Image.new('RGB', (64, 64), color = 'blue')

    def create_menu():
        # Detectar impresoras disponibles
        printers = detect_usb_printers()

        # Crear submenús dinámicos
        comanda_submenu_items = [
                                    pystray.MenuItem(p['name'], set_printer('comandas'))
                                    for p in printers
                                ] or [pystray.MenuItem("No hay impresoras", lambda _: None, enabled=False)]

        factura_submenu_items = [
                                    pystray.MenuItem(p['name'], set_printer('facturas'))
                                    for p in printers
                                ] or [pystray.MenuItem("No hay impresoras", lambda _: None, enabled=False)]

        # Opciones base
        menu_items = [
            pystray.MenuItem(
                f"Comandera: {selected_printers['comandas'].name if selected_printers['comandas'] else 'Sin seleccionar'}",
                pystray.Menu(*comanda_submenu_items)
            ),
            pystray.MenuItem(
                f"Facturas: {selected_printers['facturas'].name if selected_printers['facturas'] else 'Sin seleccionar'}",
                pystray.Menu(*factura_submenu_items)
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Escanear impresoras",
                lambda icon, item: refresh_menu(icon)
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Salir", lambda icon, item: exit_app(icon))
        ]

        return pystray.Menu(*menu_items)

    def refresh_menu(icon):
        icon.menu = create_menu()
        icon.update_menu()

    # Crear icono inicial
    icon = pystray.Icon("Comandera Vipe POS", image, menu=create_menu())
    icon.run()

def exit_app(icon):
    icon.stop()
    sys.exit()

# === MAIN ===
if __name__ == "__main__":
    # Iniciar suscripciones en un hilo asyncio
    loop = asyncio.new_event_loop()
    threading.Thread(
        target=loop.run_until_complete,
        args=(iniciar_suscripciones(),),
        daemon=True
    ).start()

    # Iniciar icono de bandeja en hilo principal
    iniciar_icono_tray()