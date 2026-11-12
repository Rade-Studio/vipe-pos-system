"""
pos/print_renderer.py
---------------------
Shared ESC/POS byte-stream builder for kitchen commandas and invoices.

Mirrors the logic in `lib/print/renderKitchenOrder.ts` (web) so that
both renderers produce equivalent output for the same order payload.
Manual verification: pass the same order dict to the Python and TS
renderers and compare the resulting byte streams.

Order payload (same shape as the Realtime broadcast payload)
-----------------------------------------------------------
Kitchen comanda:
    {
        "invoiceNumber": "INV-001",
        "table":        "Mesa 5",
        "waiter":       "Juan",
        "items": [
            {"name": "Arepa", "quantity": 2, "comments": "sin queso"},
            ...
        ]
    }

Invoice:
    {
        "invoiceNumber": "INV-001",
        "invoice": {
            "businessInfo": {"name": "...", "nit": "...", "address": "...", "phone": "..."},
            "bill":        {"subtotal": 0, "tax": 0, "taxPercentage": 0, "tip": 0, "tipPercentage": 0,
                             "total": 0, "totalDiscounts": 0},
            "date":        "2025-01-01T12:00:00",
            "paymentMethod": "cash",                # 'cash'|'transfer'|'nequi'|'bancolombia'|'multiple'
            "cashReceived": 0,
            "cashChange":   0,
            # New in task 10b (additive — old payloads keep working).
            "tenders": [                              # when non-empty, replaces the legacy payment block
                {"methodCode": "nequi", "methodName": "Nequi", "methodKind": "electronic",
                 "amount": 30000, "cashReceived": None},
                {"methodCode": "cash",  "methodName": "Efectivo", "methodKind": "cash",
                 "amount": 17000, "cashReceived": 20000},
                ...
            ],
            "change": 3000,                           # total change across every cash line
        },
        "displayItems": [
            {"name": "...", "quantity": 1, "price": 1000,
             "originalPrice": None, "comments": ""},
            ...
        ]
    }

Delivery (domicilios) — additive. Both payloads may carry an optional
`delivery` block; payloads without it render exactly as before:
    "delivery": {
        "customerName": "Ana", "phone": "3101234567",
        "address": "Calle 10 #5-20, Centro (Porton verde)",
        "notes": "Sin cebolla",              # optional
        "paymentMode": "prepaid" | "cash_on_delivery",
        "cashChangeFor": 50000,              # optional, only for cash_on_delivery
        "deliveryFee": 3000,
    }
Comanda header — additive. A command may carry `orderNumber` (the order's
number) and `station` {id, name} (one comanda per prep station): the title
becomes `COMANDA #130 — Mesa 1` and `Estación: Cocina` follows it. Old jobs
without them render exactly as before.

Kitchen tickets print `COMANDA — DOMICILIO` + `Cliente:` instead of
`Mesa N` (`table` may be null) and the order notes. Invoices print the
customer, phone and address instead of MESA/MESERO, a `DOMICILIO:` fee
line that is part of TOTAL SIN PROPINA, and `CAMBIO PARA:` for COD.

When `invoice.tenders` is present and non-empty, the ticket prints
`FORMAS DE PAGO:` followed by one `NAME  $amount` line per tender
(amount right-padded to 10 chars), a per-cash-line `RECIBIDO / CAMBIO`
sub-line when `cashReceived > amount`, and a total `CAMBIO` line when
`invoice.change > 0`. Otherwise the legacy single-label `FORMA DE PAGO:`
+ `RECIBIDO:` / `CAMBIO:` block is rendered unchanged. Malformed tender
entries (missing keys, non-numeric `amount`) are dropped, and a tender
list that ends up empty after filtering falls back to the legacy block.
"""

import math
from datetime import datetime
from typing import TypedDict


# ---------------------------------------------------------------------------
# Shared data structures (mirror of lib/print/renderKitchenOrder.ts)
# ---------------------------------------------------------------------------

class PrintLine(TypedDict, total=False):
    text: str
    bold: bool
    align: str  # 'left' | 'center' | 'right'


class KitchenOrderRender(TypedDict):
    lines: list[PrintLine]
    footer: list[PrintLine]


class InvoiceRender(TypedDict):
    lines: list[PrintLine]


# ---------------------------------------------------------------------------
# Kitchen comanda renderer
# ---------------------------------------------------------------------------

def render_kitchen_order(order: dict) -> KitchenOrderRender:
    """
    Render a kitchen comanda from an order payload.

    Mirrors ``lib/print/renderKitchenOrder(order)`` in TypeScript.
    """
    table = order.get("table", "N/A")
    waiter = order.get("waiter", "N/A")
    items = order.get("items", [])
    delivery = _delivery_block(order.get("delivery"))

    date_str = datetime.now().strftime("%d/%m/%Y %H:%M")
    order_number = order.get("orderNumber")
    title = "COMANDA" if order_number is None else f"COMANDA #{order_number}"
    station = order.get("station")
    station_name = station.get("name") if isinstance(station, dict) else None
    station_lines: list[PrintLine] = (
        [{"text": f"Estación: {station_name}", "bold": False, "align": "left"}] if station_name else []
    )

    takeaway = order.get("takeaway")
    if isinstance(takeaway, dict):
        # S8: a takeaway order prints its label where the table goes.
        place = takeaway.get("label") or f"PARA LLEVAR · {takeaway.get('customerName') or 'N/A'}"
    else:
        place = f"Mesa {table}"

    if delivery is None:
        lines: list[PrintLine] = [
            {"text": f"{title} — {place}", "bold": True, "align": "center"},
            *station_lines,
            {"text": f"Fecha:  {date_str}", "bold": False, "align": "left"},
            {"text": f"Mesero: {waiter}", "bold": False, "align": "left"},
            {"text": "--------------------------------", "bold": False, "align": "center"},
        ]
    else:
        lines = [
            {"text": f"{title} — DOMICILIO", "bold": True, "align": "center"},
            *station_lines,
            {"text": f"Fecha:  {date_str}", "bold": False, "align": "left"},
            {"text": f"Cliente: {delivery.get('customerName') or 'N/A'}", "bold": False, "align": "left"},
            {"text": f"Mesero: {waiter}", "bold": False, "align": "left"},
            {"text": "--------------------------------", "bold": False, "align": "center"},
        ]

    for item in items:
        name = (item.get("name") or "").upper()
        qty = item.get("quantity", 1)
        comments = (item.get("comments") or "").strip()
        lines.append({"text": f"{name:<30} x{qty}", "bold": False, "align": "left"})
        for label, _price in _modifier_rows(item):
            lines.append({"text": f"  {label}", "bold": False, "align": "left"})
        if comments:
            lines.append({"text": f"  {comments.capitalize()}", "bold": False, "align": "left"})

    notes = ((delivery or {}).get("notes") or "").strip()
    if notes:
        lines.append({"text": f"NOTAS: {notes}", "bold": False, "align": "left"})

    lines.append({"text": "--------------------------------", "bold": False, "align": "center"})

    footer: list[PrintLine] = [
        {"text": "VipePOS", "bold": True, "align": "center"},
    ]

    return {"lines": lines, "footer": footer}


def build_comanda_bytes(order: dict, encoding: str = "cp1252") -> bytes:
    """
    Build the raw ESC/POS byte stream for a kitchen comanda.

    Parameters
    ----------
    order    : dict — kitchen order payload (see module docstring).
    encoding : str  — 'utf-8' or 'cp1252'.

    Returns
    -------
    bytes
        Complete ESC/POS byte stream including cut command.
    """
    if encoding == "utf-8":
        encoder = lambda s: s.encode("utf-8", errors="replace")
    else:
        encoder = lambda s: s.encode("cp1252", errors="replace")

    rendered = render_kitchen_order(order)
    chunks: list[bytes] = []

    for line in rendered["lines"] + rendered["footer"]:
        text = line.get("text", "")
        align = line.get("align", "left")
        bold = line.get("bold", False)

        if bold:
            chunks.append(b"\x1b\x45\x01")  # ESC E 1 — bold on

        # Alignment: 0=left, 1=center, 2=right
        align_byte = {"left": b"\x1b\x61\x00", "center": b"\x1b\x61\x01", "right": b"\x1b\x61\x02"}.get(
            align, b"\x1b\x61\x00"
        )
        chunks.append(align_byte)
        chunks.append(encoder(text))
        chunks.append(b"\n")

        if bold:
            chunks.append(b"\x1b\x45\x00")  # ESC E 0 — bold off

    chunks.append(b"\n\n\n")
    chunks.append(b"\x1d\x56\x00")  # GS V 0 — full cut

    return b"".join(chunks)


# ---------------------------------------------------------------------------
# Invoice renderer
# ---------------------------------------------------------------------------

def render_invoice(invoice_number: str, invoice: dict, display_items: list[dict]) -> InvoiceRender:
    """
    Render an invoice from its component parts.

    Mirrors ``lib/print/renderInvoice(...)`` in TypeScript.
    """
    business = invoice.get("businessInfo", {})
    bill = invoice.get("bill", {})

    lines: list[PrintLine] = []

    # Header
    for text in [
        business.get("name", "RESTAURANTE").upper(),
        f"NIT: {business.get('nit', 'N/A')}",
        business.get("address", "N/A"),
        f"Tel: {business.get('phone', 'N/A')}",
        "--------------------------------",
    ]:
        lines.append({"text": text, "bold": False, "align": "center"})

    # Invoice info
    delivery = _delivery_block(invoice.get("delivery"))
    date_str = _format_invoice_date(invoice.get("date", ""))
    info_rows = [
        ("FACTURA:", invoice.get("invoiceNumber", invoice_number)),
        ("FECHA:", date_str),
    ]
    if delivery is None:
        info_rows += [
            ("MESA:", invoice.get("table", "N/A")),
            ("MESERO:", invoice.get("waiter", "N/A")),
        ]
    for label, value in info_rows:
        lines.append({"text": f"{label:<12}{value}", "bold": False, "align": "left"})
    if delivery is not None:
        lines.extend(_delivery_invoice_lines(delivery))

    lines.append({"text": "--------------------------------", "bold": False, "align": "center"})
    lines.append({"text": "CANT DESCRIPCION            IMPORTE", "bold": False, "align": "left"})

    # Items
    for item in display_items:
        name = item.get("name", "")
        qty = item.get("quantity", 1)
        price = item.get("price", 0) * qty
        lines.append(
            {
                "text": f"{qty:<4}{name:<20.20}{_format_currency(price):>10}",
                "bold": False,
                "align": "left",
            }
        )
        # F7: the options with their unit price; the line total above already includes them.
        for label, opt_price in _modifier_rows(item):
            text = f"  {label:<22.22}{'$' + _format_currency(opt_price):>10}" if opt_price > 0 else f"  {label:.32}"
            lines.append({"text": text, "bold": False, "align": "left"})

    lines.append({"text": "--------------------------------", "bold": False, "align": "center"})

    # Totals
    for label, value in [
        (f"SUBTOTAL: {_format_currency(bill.get('subtotal', 0))}", False),
        (f"IVA: {_format_currency(bill.get('tax', 0))}", False),
    ]:
        lines.append({"text": label, "bold": False, "align": "left"})

    if bill.get("totalDiscounts", 0) > 0:
        lines.append(
            {
                "text": f"DESCUENTOS: -{_format_currency(bill.get('totalDiscounts', 0))}",
                "bold": False,
                "align": "left",
            }
        )

    fee = delivery.get("deliveryFee", 0) if delivery is not None else 0
    if delivery is not None:
        lines.append({"text": f"DOMICILIO: {_format_currency(fee)}", "bold": False, "align": "left"})

    subtotal = bill.get("subtotal", 0) + bill.get("tax", 0) + fee
    lines.append(
        {"text": f"TOTAL SIN PROPINA: {_format_currency(subtotal)}", "bold": False, "align": "left"}
    )
    lines.append(
        {
            "text": f"PROPINA VOLUNTARIA ({bill.get('tipPercentage', 0)}%): "
            f"{_format_currency(bill.get('tip', 0))}",
            "bold": False,
            "align": "left",
        }
    )
    lines.append(
        {"text": f"TOTAL A PAGAR: {_format_currency(bill.get('total', 0))}", "bold": True, "align": "left"}
    )

    lines.append({"text": "--------------------------------", "bold": False, "align": "center"})

    # Payment method. The multi-tender path takes over when there is at
    # least one valid tender line; otherwise we fall back to the legacy
    # single-label block (so historical invoices reprint unchanged).
    valid_tenders, _all_malformed = _normalize_tenders(invoice.get("tenders"))
    if valid_tenders:
        lines.append({"text": "FORMAS DE PAGO:", "bold": False, "align": "left"})
        # `invoice.change` is the authoritative total the new payload
        # carries. When it is missing (e.g. a hand-built test fixture)
        # we fall back to the per-line change so the total stays correct.
        total_change = invoice.get("change", 0)
        change_provided = "change" in invoice and invoice.get("change") is not None
        for t in valid_tenders:
            name = (t.get("methodName") or t.get("methodCode") or "").upper()
            amount = t["amount"]
            lines.append(
                {
                    "text": f"{name}  {_format_currency(amount).rjust(10)}",
                    "bold": False,
                    "align": "left",
                }
            )
            if t.get("methodKind") == "cash":
                received = t.get("cashReceived")
                if received is not None and received > amount:
                    line_change = received - amount
                    lines.append(
                        {
                            "text": f"  RECIBIDO {_format_currency(received).rjust(8)} / "
                            f"CAMBIO {_format_currency(line_change).rjust(8)}",
                            "bold": False,
                            "align": "left",
                        }
                    )
                    if not change_provided:
                        total_change += line_change
        if (total_change or 0) > 0:
            lines.append(
                {
                    "text": f"CAMBIO: {_format_currency(total_change)}",
                    "bold": False,
                    "align": "left",
                }
            )
    else:
        # Legacy path, also used when every tender entry was malformed:
        # the web always fills paymentMethod ("multiple" for mixed
        # payments), so it stays the label source.
        method_text = _payment_method_text(invoice.get("paymentMethod", "N/A"))
        lines.append({"text": f"FORMA DE PAGO: {method_text}", "bold": False, "align": "left"})

        if invoice.get("cashReceived", 0) > 0:
            for label in [
                f"RECIBIDO: {_format_currency(invoice.get('cashReceived', 0))}",
                f"CAMBIO: {_format_currency(invoice.get('cashChange', 0))}",
            ]:
                lines.append({"text": label, "bold": False, "align": "left"})

    lines.append({"text": "--------------------------------", "bold": False, "align": "center"})

    # Footer
    for text in ["GRACIAS POR SU COMPRA!", "VUELVA PRONTO"]:
        lines.append({"text": text, "bold": False, "align": "center"})

    return {"lines": lines}


def build_invoice_bytes(
    invoice_number: str, invoice: dict, display_items: list[dict], encoding: str = "cp1252"
) -> bytes:
    """
    Build the raw ESC/POS byte stream for an invoice.

    Parameters
    ----------
    invoice_number : str
    invoice        : dict — invoice sub-payload (see module docstring).
    display_items  : list[dict]
    encoding      : str — 'utf-8' or 'cp1252'.

    Returns
    -------
    bytes
        Complete ESC/POS byte stream including cut command.
    """
    if encoding == "utf-8":
        encoder = lambda s: s.encode("utf-8", errors="replace")
    else:
        encoder = lambda s: s.encode("cp1252", errors="replace")

    rendered = render_invoice(invoice_number, invoice, display_items)
    chunks: list[bytes] = []

    for line in rendered["lines"]:
        text = line.get("text", "")
        align = line.get("align", "left")
        bold = line.get("bold", False)

        if bold:
            chunks.append(b"\x1b\x45\x01")

        align_byte = {"left": b"\x1b\x61\x00", "center": b"\x1b\x61\x01", "right": b"\x1b\x61\x02"}.get(
            align, b"\x1b\x61\x00"
        )
        chunks.append(align_byte)
        chunks.append(encoder(text))
        chunks.append(b"\n")

        if bold:
            chunks.append(b"\x1b\x45\x00")

    chunks.append(b"\n\n\n")
    chunks.append(b"\x1d\x56\x00")  # GS V 0 — full cut

    return b"".join(chunks)


# ---------------------------------------------------------------------------
# Informe X renderer (informe-x-termico S1)
# ---------------------------------------------------------------------------
#
# Payload of an ``x_report`` job: ``{business {name, nit, address},
# cashierName, openedAt, printedAt, summary, tax? {type, rate}}`` with the
# summary exactly as GET /registers/summary answered and the times as ISO
# date-times in the cashier's wall time. The lines are those of the web slip
# (components/printing/XReportSlip.tsx, ``xReportLines``), pinned in
# lib/print/x-report-fixture.json; desktop/core/src/escpos/x_report.rs prints
# the same.

_MINUS = "\u2212"


def slip_chars(paper_mm: int = 80) -> int:
    """~42 characters a line on 80 mm paper, ~32 on 58 mm."""
    return 32 if paper_mm == 58 else 42


def _js_round(value) -> float:
    """``Math.round``: halves go up."""
    return math.floor(value + 0.5)


def _pesos(amount) -> str:
    """``$ 1.234.567``; a negative amount reads ``−$ 3.500``."""
    digits = f"{int(abs(_js_round(amount))):,}".replace(",", ".")
    return f"{_MINUS if amount < 0 else ''}$ {digits}"


def _js_number(value) -> str:
    """``String(n)`` of a JSON number."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _pad_line(left: str, right: str, width: int) -> str:
    if not right:
        return f"{left[:width - 1]}\u2026" if len(left) > width else left
    room = width - len(right) - 1
    label = f"{left[:max(0, room - 1)]}\u2026" if len(left) > room else left
    return f"{label}{' ' * max(1, width - len(label) - len(right))}{right}"


def _center_line(text: str, width: int) -> str:
    cut = text[:width] if len(text) > width else text
    return f"{' ' * ((width - len(cut)) // 2)}{cut}"


def _slip_date_time(value) -> str:
    """``10/11/2026 7:58 a.m.`` in the value's own wall time; the raw text when it does not parse."""
    try:
        at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        try:  # Python < 3.11 refuses milliseconds with an offset; the wall time is the first 16 characters.
            at = datetime.strptime(str(value)[:16], "%Y-%m-%dT%H:%M")
        except ValueError:
            return str(value or "")
    hour = at.hour
    return f"{at:%d/%m/%Y} {12 if hour % 12 == 0 else hour % 12}:{at.minute:02d} {'a.m.' if hour < 12 else 'p.m.'}"


def render_x_report(payload: dict, paper_mm: int = 80) -> list[PrintLine]:
    width = slip_chars(paper_mm)
    summary = payload["summary"]
    business = payload.get("business") or {}

    def line(text, bold=False) -> PrintLine:
        return {"text": text, "bold": bold, "align": "left"}

    def row(left, right, bold=False) -> PrintLine:
        return line(_pad_line(left, right, width), bold)

    rule = line("-" * width)
    lines = [line(_center_line(str(business.get("name") or "").upper(), width), True)]
    if business.get("nit"):
        lines.append(line(_center_line(f"NIT {business['nit']}", width)))
    if business.get("address"):
        lines.append(line(_center_line(business["address"], width)))
    cashier = payload.get("cashierName")
    lines += [
        rule,
        line(_center_line("INFORME X", width), True),
        line(_center_line("Parcial \u00b7 No reinicia contadores", width)),
        rule,
        row("Cajero", cashier if isinstance(cashier, str) else "\u2014"),
        row("Abierto", _slip_date_time(payload.get("openedAt"))),
        row("Impreso", _slip_date_time(payload.get("printedAt"))),
        rule,
        line("Ventas por m\u00e9todo", True),
    ]
    methods = [m for m in summary.get("methods") or [] if isinstance(m, dict)]
    for method in methods:
        if method["total"] > 0 or method.get("isActive") is True:
            lines.append(row(f"{method.get('name') or ''} ({_js_number(method.get('tendersCount'))})", _pesos(method["total"])))
    cash_sales = sum(m["total"] for m in methods if m.get("kind") == "cash")
    sales = summary["totalSales"]
    lines.append(row("Ventas", _pesos(sales), True))
    tax = payload.get("tax")
    if isinstance(tax, dict):
        rate = tax["rate"]
        base = _js_round(sales * 100 / (100 + rate))
        label = f"{tax.get('type') or 'INC'} ({_js_number(rate).replace('.', ',', 1)} %)"
        lines += [row("Base", _pesos(base)), row(label, _pesos(sales - base))]
    lines += [
        row("Tiquetes", _js_number(summary["paymentsCount"])),
        rule,
        line("Efectivo en caja", True),
        row("Fondo de caja", _pesos(summary["initialCash"])),
        row("+ Ventas en efectivo", _pesos(cash_sales)),
    ]
    if summary["totalChange"] > 0:
        lines.append(row(f"{_MINUS} Cambio entregado", _pesos(summary["totalChange"])))
    lines += [
        row("+ Entradas", _pesos(summary["cashDeposits"])),
        row(f"{_MINUS} Salidas", _pesos(summary["cashWithdrawals"])),
        row("Esperado ahora", _pesos(summary["expectedCash"]), True),
        rule,
        row("Propinas (aparte)", _pesos(summary["totalTips"])),
        line("No son ingreso del restaurante."),
        rule,
        line(_center_line("Este informe no cierra el turno.", width)),
    ]
    return lines


def build_x_report_bytes(payload: dict, encoding: str = "cp1252", paper_mm: int = 80) -> bytes:
    """ESC/POS bytes of an Informe X; CP1252 has no U+2212, so its minus prints as a hyphen."""
    chunks: list[bytes] = []
    for line in render_x_report(payload, paper_mm):
        text = line["text"]
        if encoding != "utf-8":
            text = text.replace(_MINUS, "-")
        if line["bold"]:
            chunks.append(b"\x1b\x45\x01")
        chunks.append(b"\x1b\x61\x00")
        chunks.append(text.encode("utf-8" if encoding == "utf-8" else "cp1252", errors="replace"))
        chunks.append(b"\n")
        if line["bold"]:
            chunks.append(b"\x1b\x45\x00")
    chunks.append(b"\n\n\n")
    chunks.append(b"\x1d\x56\x00")  # GS V 0 — full cut
    return b"".join(chunks)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _delivery_block(raw):
    """Return the `delivery` payload block when it is a dict, else None."""
    if not isinstance(raw, dict):
        return None
    fee = raw.get("deliveryFee")
    if not isinstance(fee, (int, float)) or isinstance(fee, bool):
        fee = 0
    return {**raw, "deliveryFee": fee}


def _delivery_invoice_lines(delivery: dict) -> list[PrintLine]:
    """Customer / phone / address (and COD change) rows of a delivery invoice."""
    rows = [
        f"CLIENTE: {delivery.get('customerName') or 'N/A'}",
        f"TEL: {delivery.get('phone') or 'N/A'}",
        f"DIRECCION: {delivery.get('address') or 'N/A'}",
    ]
    change_for = delivery.get("cashChangeFor")
    if (
        delivery.get("paymentMode") == "cash_on_delivery"
        and isinstance(change_for, (int, float))
        and not isinstance(change_for, bool)
        and change_for > 0
    ):
        rows.append(f"CAMBIO PARA: {_format_currency(change_for)}")
    return [{"text": text, "bold": False, "align": "left"} for text in rows]


def _modifier_rows(item: dict) -> list[tuple[str, float]]:
    """F7: (label, price) per option of a line, ``modifiers [{group, name, price}]``.

    A priced option reads "+ name"; a $0 one "Group: name" unless the name already
    starts with the group ("Sin cebolla"), as ``lib/modifiers/rules.modifierLabel``.
    Missing or malformed entries print nothing, so old lines print as before.
    """
    raw = item.get("modifiers")
    rows: list[tuple[str, float]] = []
    for modifier in raw if isinstance(raw, list) else []:
        if not isinstance(modifier, dict):
            continue
        name = str(modifier.get("name") or "")
        group = str(modifier.get("group") or "").strip()
        price = modifier.get("price")
        price = price if isinstance(price, (int, float)) and not isinstance(price, bool) else 0
        if price > 0:
            label = f"+ {name}"
        elif name.lower().startswith(group.lower()):
            label = name
        else:
            label = f"{group}: {name}"
        rows.append((label, price))
    return rows


def _format_currency(value: float) -> str:
    """Format integer cents as Colombian peso string (no decimals, dot separator)."""
    return f"{int(round(value)):,}".replace(",", ".")


def _format_invoice_date(date_str: str) -> str:
    """Parse ISO date string and format as dd/mm/yyyy hh:mm:ss."""
    try:
        dt = datetime.fromisoformat(date_str)
    except Exception:
        dt = datetime.now()
    return dt.strftime("%d/%m/%Y %H:%M:%S")


def _payment_method_text(method: str) -> str:
    """Translate payment method code to Spanish label."""
    return {
        "cash": "Efectivo",
        "transfer": "Transferencia",
        "nequi": "Nequi",
        "bancolombia": "Bancolombia App",
    }.get(method.lower(), method.capitalize() if method else "N/A")


def _normalize_tenders(raw):
    """Filter and validate the raw `tenders` array from the payload.

    Returns ``(valid, all_malformed)``:
      - ``valid``: list of tender dicts with an ``int`` ``amount`` and the
        keys we render (`methodCode`, `methodName`, `methodKind`,
        `amount`, optional `cashReceived`).
      - ``all_malformed``: True when the payload had a tender list but
        every entry failed validation, so the legacy payment block can
        be used as a safe fallback. Missing keys and non-integer
        ``amount`` values cause the entry to be dropped; a non-dict
        entry (or a non-list raw value) is treated the same way.
    """
    if not isinstance(raw, list):
        return [], False
    valid: list[dict] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        amount = entry.get("amount")
        if not isinstance(amount, int) or isinstance(amount, bool):
            continue
        if not entry.get("methodCode") and not entry.get("methodName"):
            continue
        normalized = {
            "methodCode": entry.get("methodCode") or "",
            "methodName": entry.get("methodName") or entry.get("methodCode") or "",
            "methodKind": entry.get("methodKind") or "electronic",
            "amount": amount,
            "cashReceived": entry.get("cashReceived"),
        }
        valid.append(normalized)
    return valid, (len(raw) > 0 and len(valid) == 0)
