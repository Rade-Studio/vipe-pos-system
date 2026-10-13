"""
pos/test_print_renderer.py
--------------------------
Regression tests for the ESC/POS invoice renderer.

Covers both the legacy single-label payment block (pre-10b payloads) and the
new multi-tender block sent by the web app after task 10a. The legacy tests
assert byte-exact output captured before the tender branch was added, so any
unintentional drift on existing tickets fails the suite.
"""

import hashlib
import unittest

try:  # when run from repo root
    from pos.print_renderer import build_invoice_bytes, render_invoice, render_kitchen_order
except ImportError:  # when run from inside pos/
    from print_renderer import build_invoice_bytes, render_invoice, render_kitchen_order


# ---------------------------------------------------------------------------
# Test fixtures shared by the test cases
# ---------------------------------------------------------------------------

_BASE_BILL = {
    "subtotal": 10000,
    "tax": 1900,
    "taxPercentage": 19,
    "tip": 0,
    "tipPercentage": 0,
    "total": 11900,
    "totalDiscounts": 0,
}

_BASE_BUSINESS = {
    "name": "Mi Restaurante",
    "nit": "900.000.000-1",
    "address": "Calle 1 #2-3",
    "phone": "3001234567",
}

_BASE_ITEM = {"name": "Hamburguesa", "quantity": 1, "price": 10000}


def _render_lines(invoice: dict, display_items=None, invoice_number: str = "INV-abc12345"):
    """Helper: call render_invoice and return the textual lines as a list."""
    result = render_invoice(invoice_number, invoice, display_items or [_BASE_ITEM])
    return [line["text"] for line in result["lines"]]


# ---------------------------------------------------------------------------
# Legacy single-label payment block — must be byte-exact unchanged
# ---------------------------------------------------------------------------
#
# These snapshots were captured from pos/print_renderer.py BEFORE task 10b
# (commit 12276f5) added the multi-tender branch. If the legacy path drifts,
# existing tickets (the admin reprints hundreds of these a day) will print
# differently. Update intentionally only after the snapshot is reviewed.

LEGACY_CASH = [
    "MI RESTAURANTE",
    "NIT: 900.000.000-1",
    "Calle 1 #2-3",
    "Tel: 3001234567",
    "--------------------------------",
    "FACTURA:    INV-abc12345",
    "FECHA:      06/10/2026 15:00:52",
    "MESA:       5",
    "MESERO:     Juan",
    "--------------------------------",
    "CANT DESCRIPCION            IMPORTE",
    "1   Hamburguesa             10.000",
    "--------------------------------",
    "SUBTOTAL: 10.000",
    "IVA: 1.900",
    "TOTAL SIN PROPINA: 11.900",
    "PROPINA VOLUNTARIA (0%): 0",
    "TOTAL A PAGAR: 11.900",
    "--------------------------------",
    "FORMA DE PAGO: Efectivo",
    "RECIBIDO: 20.000",
    "CAMBIO: 8.100",
    "--------------------------------",
    "GRACIAS POR SU COMPRA!",
    "VUELVA PRONTO",
]


LEGACY_NEQUI_NO_CASH = [
    "MI RESTAURANTE",
    "NIT: 900.000.000-1",
    "Calle 1 #2-3",
    "Tel: 3001234567",
    "--------------------------------",
    "FACTURA:    INV-abc12345",
    "FECHA:      06/10/2026 15:00:52",
    "MESA:       5",
    "MESERO:     Juan",
    "--------------------------------",
    "CANT DESCRIPCION            IMPORTE",
    "1   Hamburguesa             10.000",
    "--------------------------------",
    "SUBTOTAL: 10.000",
    "IVA: 1.900",
    "TOTAL SIN PROPINA: 11.900",
    "PROPINA VOLUNTARIA (0%): 0",
    "TOTAL A PAGAR: 11.900",
    "--------------------------------",
    "FORMA DE PAGO: Nequi",
    "--------------------------------",
    "GRACIAS POR SU COMPRA!",
    "VUELVA PRONTO",
]


LEGACY_MULTIPLE = [
    "MI RESTAURANTE",
    "NIT: 900.000.000-1",
    "Calle 1 #2-3",
    "Tel: 3001234567",
    "--------------------------------",
    "FACTURA:    INV-abc12345",
    "FECHA:      06/10/2026 15:00:52",
    "MESA:       5",
    "MESERO:     Juan",
    "--------------------------------",
    "CANT DESCRIPCION            IMPORTE",
    "1   Hamburguesa             10.000",
    "--------------------------------",
    "SUBTOTAL: 10.000",
    "IVA: 1.900",
    "TOTAL SIN PROPINA: 11.900",
    "PROPINA VOLUNTARIA (0%): 0",
    "TOTAL A PAGAR: 11.900",
    "--------------------------------",
    "FORMA DE PAGO: Multiple",
    "--------------------------------",
    "GRACIAS POR SU COMPRA!",
    "VUELVA PRONTO",
]


class LegacySingleLabelTests(unittest.TestCase):
    """Legacy payloads without `tenders` must render exactly as before."""

    def test_cash_with_change_is_byte_exact(self):
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "table": 5,
            "waiter": "Juan",
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "cash",
            "cashReceived": 20000,
            "cashChange": 8100,
        }
        self.assertEqual(_render_lines(invoice), LEGACY_CASH)

    def test_nequi_without_cash_has_no_recibido_change(self):
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "table": 5,
            "waiter": "Juan",
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "nequi",
        }
        self.assertEqual(_render_lines(invoice), LEGACY_NEQUI_NO_CASH)

    def test_legacy_multiple_label_uses_capitalize_convention(self):
        """Without a tender list, the legacy `multiple` code falls through
        to `_payment_method_text`'s capitalize() branch, so the printed
        label is `Multiple` (matching the existing Python convention).
        The TS twin translates it to `MÚLTIPLES` only because it has an
        explicit map entry; here we lock the current Python behaviour."""
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "table": 5,
            "waiter": "Juan",
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "multiple",
        }
        self.assertEqual(_render_lines(invoice), LEGACY_MULTIPLE)


# ---------------------------------------------------------------------------
# Tender path — new behavior introduced by task 10b
# ---------------------------------------------------------------------------


class TenderPathTests(unittest.TestCase):
    """When `tenders` is present and non-empty, the ticket prints the
    multi-tender breakdown. Mirrors `lib/print/renderKitchenOrder.ts`."""

    def test_single_nequi_prints_tender_block(self):
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "nequi",
            "tenders": [
                {
                    "methodCode": "nequi",
                    "methodName": "Nequi",
                    "methodKind": "electronic",
                    "amount": 11900,
                    "cashReceived": None,
                }
            ],
        }
        text = _render_lines(invoice)
        joined = "\n".join(text)
        self.assertIn("FORMAS DE PAGO:", joined)
        self.assertRegex(joined, r"NEQUI\s+11\.900")
        # No per-line RECIBIDO / CAMBIO for an electronic line.
        self.assertNotIn("RECIBIDO", joined)
        self.assertNotIn("CAMBIO:", joined)
        # The legacy single-label block must NOT appear alongside the
        # tender list (it would print a duplicate "FORMA DE PAGO:" line).
        self.assertNotIn("FORMA DE PAGO: ", joined)

    def test_mixed_cash_and_nequi_with_overpay(self):
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "multiple",
            "tenders": [
                {
                    "methodCode": "nequi",
                    "methodName": "Nequi",
                    "methodKind": "electronic",
                    "amount": 30000,
                    "cashReceived": None,
                },
                {
                    "methodCode": "cash",
                    "methodName": "Efectivo",
                    "methodKind": "cash",
                    "amount": 17000,
                    "cashReceived": 20000,
                },
            ],
            "change": 3000,
        }
        text = _render_lines(invoice)
        joined = "\n".join(text)
        self.assertIn("FORMAS DE PAGO:", joined)
        self.assertRegex(joined, r"NEQUI\s+30\.000")
        self.assertRegex(joined, r"EFECTIVO\s+17\.000")
        self.assertRegex(joined, r"RECIBIDO\s+20\.000\s*/\s*CAMBIO\s+3\.000")
        self.assertIn("CAMBIO: 3.000", joined)
        self.assertNotIn("FORMA DE PAGO: ", joined)

    def test_exact_cash_payment_omits_cambio_block(self):
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "cash",
            "tenders": [
                {
                    "methodCode": "cash",
                    "methodName": "Efectivo",
                    "methodKind": "cash",
                    "amount": 11900,
                    "cashReceived": 11900,
                }
            ],
        }
        text = _render_lines(invoice)
        joined = "\n".join(text)
        self.assertIn("FORMAS DE PAGO:", joined)
        self.assertRegex(joined, r"EFECTIVO\s+11\.900")
        # No overpay -> no RECIBIDO / CAMBIO lines at all.
        self.assertNotIn("RECIBIDO", joined)
        self.assertNotIn("CAMBIO:", joined)

    def test_legacy_multiple_with_tender_list_uses_tender_block(self):
        """When `tenders` is provided, paymentMethod='multiple' should not
        produce a legacy 'FORMA DE PAGO: Multiple' line — the tender list
        is the source of truth."""
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "multiple",
            "tenders": [
                {
                    "methodCode": "cash",
                    "methodName": "Efectivo",
                    "methodKind": "cash",
                    "amount": 11900,
                    "cashReceived": 11900,
                }
            ],
        }
        joined = "\n".join(_render_lines(invoice))
        self.assertIn("FORMAS DE PAGO:", joined)
        self.assertNotIn("FORMA DE PAGO: ", joined)

    def test_tender_block_alignment_right_pads_amount(self):
        """Each tender line is right-padded so the $amount column lines up."""
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "nequi",
            "tenders": [
                {
                    "methodCode": "nequi",
                    "methodName": "Nequi",
                    "methodKind": "electronic",
                    "amount": 11900,
                    "cashReceived": None,
                }
            ],
        }
        lines = _render_lines(invoice)
        nequi_line = next(line for line in lines if line.startswith("NEQUI"))
        # The TS twin pads the amount to a fixed width on the right.
        # Pin the format: "<NAME>  <amount right-justified to 10>".
        # Lock both the separator and the right-padding so the printed
        # ticket aligns with the web preview.
        self.assertTrue(nequi_line.startswith("NEQUI  "), nequi_line)
        self.assertTrue(nequi_line.endswith("11.900"), nequi_line)
        # Amount column is padded to width 10.
        amount_str = nequi_line[len("NEQUI  "):]
        self.assertEqual(len(amount_str), 10)
        self.assertEqual(amount_str.strip(), "11.900")


class MalformedTenderFallbackTests(unittest.TestCase):
    """The listener must never crash on a weird payload."""

    def test_tender_missing_amount_falls_back_to_legacy_block(self):
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "cash",
            "cashReceived": 20000,
            "cashChange": 8100,
            "tenders": [
                {"methodCode": "cash", "methodName": "Efectivo", "methodKind": "cash"}
            ],
        }
        joined = "\n".join(_render_lines(invoice))
        # The whole tender list is malformed -> the renderer must skip it
        # and print the legacy single-label block instead.
        self.assertIn("FORMA DE PAGO: Efectivo", joined)
        self.assertIn("RECIBIDO: 20.000", joined)
        self.assertIn("CAMBIO: 8.100", joined)
        self.assertNotIn("FORMAS DE PAGO:", joined)

    def test_malformed_mixed_payment_keeps_the_sent_method_label(self):
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "multiple",
            "cashReceived": 20000,
            "cashChange": 3000,
            "tenders": [{"methodCode": "cash"}, {"methodCode": "nequi"}],
        }
        joined = "\n".join(_render_lines(invoice))
        self.assertIn("FORMA DE PAGO: Multiple", joined)
        self.assertNotIn("FORMA DE PAGO: Efectivo", joined)

    def test_tender_non_int_amount_falls_back_to_legacy_block(self):
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "cash",
            "cashReceived": 20000,
            "cashChange": 8100,
            "tenders": [
                {
                    "methodCode": "cash",
                    "methodName": "Efectivo",
                    "methodKind": "cash",
                    "amount": "not-a-number",
                    "cashReceived": None,
                }
            ],
        }
        joined = "\n".join(_render_lines(invoice))
        self.assertIn("FORMA DE PAGO: Efectivo", joined)
        self.assertIn("RECIBIDO: 20.000", joined)
        self.assertIn("CAMBIO: 8.100", joined)
        self.assertNotIn("FORMAS DE PAGO:", joined)

    def test_one_bad_entry_among_valid_is_skipped_not_fatal(self):
        """A single malformed line in the middle of an otherwise valid
        tender list must be dropped, not crash the whole render."""
        invoice = {
            "businessInfo": dict(_BASE_BUSINESS),
            "bill": dict(_BASE_BILL),
            "date": "2026-10-06T15:00:52",
            "paymentMethod": "nequi",
            "tenders": [
                {
                    "methodCode": "nequi",
                    "methodName": "Nequi",
                    "methodKind": "electronic",
                    "amount": 11900,
                    "cashReceived": None,
                },
                "not-a-dict",  # garbage
                {
                    "methodCode": "cash",
                    "methodName": "Efectivo",
                    "methodKind": "cash",
                    "amount": 5000,
                    "cashReceived": None,
                },
            ],
        }
        joined = "\n".join(_render_lines(invoice))
        # The two valid lines are still rendered.
        self.assertIn("FORMAS DE PAGO:", joined)
        self.assertRegex(joined, r"NEQUI\s+11\.900")
        self.assertRegex(joined, r"EFECTIVO\s+5\.000")


# ---------------------------------------------------------------------------
# Delivery (domicilios) — additive `delivery` block
# ---------------------------------------------------------------------------

_DELIVERY = {
    "customerName": "Ana Perez",
    "phone": "3101234567",
    "address": "Calle 10 #5-20, Centro (Porton verde)",
    "notes": "Sin cebolla",
    "paymentMode": "cash_on_delivery",
    "cashChangeFor": 50000,
    "deliveryFee": 3000,
}

_KITCHEN_ITEMS = [
    {"name": "Arepa", "quantity": 2, "comments": "sin queso"},
    {"name": "Jugo", "quantity": 1},
]


def _kitchen_lines(order: dict):
    return [line["text"] for line in render_kitchen_order(order)["lines"]]


class DineInByteIdentityTests(unittest.TestCase):
    """Golden snapshots captured BEFORE the delivery block existed."""

    def test_dine_in_kitchen_ticket_is_unchanged(self):
        lines = _kitchen_lines(
            {"invoiceNumber": "1234", "table": 5, "waiter": "Juan", "items": _KITCHEN_ITEMS}
        )
        self.assertTrue(lines[0] == "COMANDA \u2014 Mesa 5")
        self.assertEqual(
            lines[2:],
            [
                "Mesero: Juan",
                "--------------------------------",
                "AREPA                          x2",
                "  Sin queso",
                "JUGO                           x1",
                "--------------------------------",
            ],
        )

    def test_dine_in_invoice_bytes_are_unchanged(self):
        invoice = {
            "businessInfo": {"name": "Mi Rest", "nit": "900", "address": "Calle 1", "phone": "300"},
            "bill": {
                "subtotal": 10000, "tax": 1900, "taxPercentage": 19, "tip": 1000,
                "tipPercentage": 10, "total": 12900, "totalDiscounts": 0,
            },
            "date": "2025-01-15T12:30:00",
            "table": 5,
            "waiter": "Juan",
            "paymentMethod": "cash",
            "cashReceived": 20000,
            "cashChange": 7100,
        }
        raw = build_invoice_bytes("INV-1", invoice, [_BASE_ITEM | {"name": "Hamburguesa"}])
        self.assertEqual(
            hashlib.sha256(raw).hexdigest(),
            "2d72bfa976cbd53c25750e363a8af9b3c813b7a53cb7e8c3962528d2e13a834e",
        )


class DeliveryKitchenTicketTests(unittest.TestCase):
    def _order(self, **extra):
        return {
            "invoiceNumber": "1234", "table": None, "waiter": "Luis",
            "items": _KITCHEN_ITEMS, "delivery": _DELIVERY, **extra,
        }

    def test_header_says_domicilio_with_customer_instead_of_mesa(self):
        lines = _kitchen_lines(self._order())
        self.assertEqual(lines[0], "COMANDA \u2014 DOMICILIO")
        self.assertEqual(lines[2], "Cliente: Ana Perez")
        self.assertNotIn("Mesa", "\n".join(lines))

    def test_order_notes_are_printed_but_not_the_address(self):
        text = "\n".join(_kitchen_lines(self._order()))
        self.assertIn("NOTAS: Sin cebolla", text)
        self.assertNotIn("Calle 10", text)

    def test_no_notes_line_when_notes_missing(self):
        delivery = {k: v for k, v in _DELIVERY.items() if k != "notes"}
        text = "\n".join(_kitchen_lines(self._order(delivery=delivery)))
        self.assertNotIn("NOTAS", text)


class DeliveryInvoiceTests(unittest.TestCase):
    def _invoice(self, delivery=_DELIVERY, **bill):
        base_bill = {
            "subtotal": 10000, "tax": 1900, "taxPercentage": 19, "tip": 0,
            "tipPercentage": 0, "total": 14900, "totalDiscounts": 0,
        }
        return {
            "businessInfo": _BASE_BUSINESS,
            "bill": {**base_bill, **bill},
            "date": "2025-01-15T12:30:00",
            "table": "\u2014",
            "waiter": "uuid-should-not-print",
            "paymentMethod": "cash",
            "delivery": delivery,
        }

    def test_prints_customer_phone_address_instead_of_mesa(self):
        text = "\n".join(_render_lines(self._invoice()))
        self.assertIn("CLIENTE: Ana Perez", text)
        self.assertIn("TEL: 3101234567", text)
        self.assertIn("DIRECCION: Calle 10 #5-20, Centro (Porton verde)", text)
        self.assertNotIn("MESA:", text)
        self.assertNotIn("MESERO:", text)

    def test_fee_line_is_included_in_total_sin_propina(self):
        lines = _render_lines(self._invoice())
        self.assertIn("DOMICILIO: 3.000", lines)
        self.assertIn("TOTAL SIN PROPINA: 14.900", lines)
        self.assertIn("TOTAL A PAGAR: 14.900", lines)
        self.assertLess(lines.index("IVA: 1.900"), lines.index("DOMICILIO: 3.000"))

    def test_total_matches_pay_order_with_tip(self):
        # pay_order charges subtotal + tax + fee + tip.
        lines = _render_lines(self._invoice(tip=1000, tipPercentage=10, total=15900))
        self.assertIn("TOTAL SIN PROPINA: 14.900", lines)
        self.assertIn("TOTAL A PAGAR: 15.900", lines)

    def test_cash_on_delivery_prints_cambio_para(self):
        self.assertIn("CAMBIO PARA: 50.000", _render_lines(self._invoice()))

    def test_prepaid_or_missing_cash_change_has_no_cambio_para(self):
        prepaid = {**_DELIVERY, "paymentMode": "prepaid", "cashChangeFor": None}
        self.assertNotIn("CAMBIO PARA", "\n".join(_render_lines(self._invoice(delivery=prepaid))))
        cod = {k: v for k, v in _DELIVERY.items() if k != "cashChangeFor"}
        self.assertNotIn("CAMBIO PARA", "\n".join(_render_lines(self._invoice(delivery=cod))))


if __name__ == "__main__":
    unittest.main()
