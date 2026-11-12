"""
pos/test_x_report.py
--------------------
"Informe X" (``x_report`` jobs, odd/tasks/informe-x-termico.md S1): the lines
of the web slip (components/printing/XReportSlip.tsx), pinned in
lib/print/x-report-fixture.json, at 80 mm and 58 mm, and the handler printing
them on the ``facturas`` printer.
"""

import copy
import json
import os
import unittest

try:  # when run from repo root
    from pos import print_jobs
    from pos.print_renderer import build_x_report_bytes, render_x_report
except ImportError:  # when run from inside pos/
    import print_jobs
    from print_renderer import build_x_report_bytes, render_x_report

FIXTURE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib", "print", "x-report-fixture.json")
with open(FIXTURE_PATH, encoding="utf-8") as fixture_file:
    FIXTURE = json.load(fixture_file)
PAYLOAD = FIXTURE["payload"]


def pairs(lines):
    return [{"text": line["text"], "bold": line.get("bold", False)} for line in lines]


class FakePrinter:
    """Records raw writes; refuses UTF-8 so negotiation lands on cp1252."""

    def __init__(self):
        self.raw = []

    def _raw(self, data):
        self.raw.append(data)

    def set(self, **kwargs):
        if kwargs.get("text_encoding") == "utf-8":
            raise ValueError("utf-8 not supported")

    @property
    def ticket(self):
        return [data for data in self.raw if data != b"\x1b\x72\x01"]


class XReportRendererTests(unittest.TestCase):

    def test_prints_the_web_slip_lines_at_80_and_58_mm(self):
        self.assertEqual(pairs(render_x_report(PAYLOAD)), FIXTURE["lines"]["80"])
        self.assertEqual(pairs(render_x_report(PAYLOAD, paper_mm=58)), FIXTURE["lines"]["58"])

    def test_without_tax_change_or_cashier_those_lines_change(self):
        payload = copy.deepcopy(PAYLOAD)
        del payload["tax"]
        payload["summary"]["totalChange"] = 0
        payload["cashierName"] = None
        texts = [line["text"] for line in render_x_report(payload)]
        self.assertFalse(any(t.startswith(("Base", "INC")) or "Cambio entregado" in t for t in texts))
        self.assertIn("Cajero" + " " * 35 + "—", texts)

    def test_bytes_are_left_aligned_bold_like_the_slip_and_cp1252_prints_the_minus_as_a_hyphen(self):
        data = build_x_report_bytes(PAYLOAD, encoding="cp1252")
        self.assertTrue(data.startswith(b"\x1b\x45\x01\x1b\x61\x00           LA FONDA DE MARIANA\n\x1b\x45\x00"))
        self.assertIn(b"- Cambio entregado", data)
        self.assertTrue(data.endswith(b"     Este informe no cierra el turno.\n\n\n\n\x1d\x56\x00"))
        self.assertIn("− Salidas".encode("utf-8"), build_x_report_bytes(PAYLOAD, encoding="utf-8"))

    def test_same_bytes_as_the_desktop_renderer_layout(self):
        """Each line: bold on, align left, text, newline, bold off; then three feeds and the cut."""
        expected = b""
        for line in FIXTURE["lines"]["58"]:
            text = line["text"].replace("−", "-").encode("cp1252")
            expected += (b"\x1b\x45\x01" if line["bold"] else b"") + b"\x1b\x61\x00" + text + b"\n" + (b"\x1b\x45\x00" if line["bold"] else b"")
        self.assertEqual(build_x_report_bytes(PAYLOAD, encoding="cp1252", paper_mm=58), expected + b"\n\n\n\x1d\x56\x00")


class XReportJobTests(unittest.TestCase):

    def test_an_x_report_prints_on_the_facturas_printer_at_any_age(self):
        facturas, comandas = FakePrinter(), FakePrinter()
        handler = print_jobs.PrintJobHandler(get_printer=lambda kind: {"facturas": facturas, "comandas": comandas}.get(kind))
        job = {"id": "x-1", "kind": "x_report", "createdAt": "2020-01-01T00:00:00Z", "payload": PAYLOAD}
        self.assertTrue(handler.handle(job))
        self.assertEqual(facturas.ticket, [build_x_report_bytes(PAYLOAD, encoding="cp1252")])
        self.assertEqual(comandas.raw, [])

    def test_an_x_report_without_summary_is_dropped_with_an_ack(self):
        facturas = FakePrinter()
        handler = print_jobs.PrintJobHandler(get_printer=lambda kind: facturas)
        self.assertTrue(handler.handle({"id": "x-2", "kind": "x_report", "payload": {"business": {}}}))
        self.assertEqual(facturas.raw, [])


if __name__ == "__main__":
    unittest.main()
