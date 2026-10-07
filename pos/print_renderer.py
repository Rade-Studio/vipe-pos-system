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

    if delivery is None:
        lines: list[PrintLine] = [
            {"text": f"COMANDA — Mesa {table}", "bold": True, "align": "center"},
            {"text": f"Fecha:  {date_str}", "bold": False, "align": "left"},
            {"text": f"Mesero: {waiter}", "bold": False, "align": "left"},
            {"text": "--------------------------------", "bold": False, "align": "center"},
        ]
    else:
        lines = [
            {"text": "COMANDA — DOMICILIO", "bold": True, "align": "center"},
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
