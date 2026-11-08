"""F7 verifier probe: pos/ renders comanda and invoice lines that carry modifiers (S6, T1 print payloads)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[0]))

import print_renderer  # noqa: E402


class ModifierPayloadTest(unittest.TestCase):
    def test_comanda_with_modifiers_renders(self):
        order = {
            "invoiceNumber": "job-1",
            "waiter": "Ana",
            "items": [
                {"name": "Hamburguesa", "quantity": 2, "comments": "Bien caliente",
                 "modifiers": [{"group": "Término", "name": "Medio", "price": 0}, {"group": "Adiciones", "name": "Tocineta", "price": 3000}]},
                {"name": "Limonada", "quantity": 1},
            ],
        }
        render = print_renderer.render_kitchen_order(order)
        self.assertIsNotNone(render)
        self.assertTrue(print_renderer.build_comanda_bytes(order))

    def test_invoice_with_modifiers_renders(self):
        items = [{"name": "Hamburguesa", "quantity": 2, "price": 23000,
                  "modifiers": [{"group": "Adiciones", "name": "Tocineta", "price": 3000}]}]
        invoice = {"subtotal": 46000, "tax": 0, "total": 46000, "tip": 0, "date": "2026-11-07T12:00:00Z"}
        render = print_renderer.render_invoice("F-1", invoice, items)
        self.assertIsNotNone(render)


if __name__ == "__main__":
    unittest.main()
