"""
pos/test_print_jobs.py
----------------------
Unit tests for the ``print_job`` handler (T8c). The payloads below are
recorded from the API socket event (``{id, kind, payload}``); the printer is
a fake that records the raw ESC/POS bytes. No network, no socket.io.
"""

import asyncio
import datetime as _datetime
import unittest
from unittest import mock

try:  # when run from repo root
    from pos import print_jobs
except ImportError:  # when run from inside pos/
    import print_jobs

PrintJobHandler = print_jobs.PrintJobHandler
PendingPoller = print_jobs.PendingPoller
drain_pending = print_jobs.drain_pending
# The renderer module the handler prints with (patched for a fixed clock).
print_renderer = print_jobs.print_renderer


COMMAND_JOB = {
    "id": "6f1c2a8e-4b1d-4c55-9a0e-2f7e3c9d1a01",
    "kind": "command",
    "payload": {
        "invoiceNumber": "6f1c2a8e-4b1d-4c55-9a0e-2f7e3c9d1a01",
        "items": [{"name": "Ajiaco", "quantity": 2, "comments": "sin alcaparras"}],
        "waiter": "Mesero Dev",
        "table": 4,
    },
}

DELIVERY_COMMAND_JOB = {
    "id": "6f1c2a8e-4b1d-4c55-9a0e-2f7e3c9d1a02",
    "kind": "command",
    "payload": {
        "invoiceNumber": "6f1c2a8e-4b1d-4c55-9a0e-2f7e3c9d1a02",
        "items": [{"name": "Bandeja paisa", "quantity": 1}],
        "waiter": "Domicilios",
        "table": None,
        "delivery": {
            "customerName": "Luis",
            "phone": "3001234567",
            "address": "Calle 1 # 2-3",
            "paymentMode": "prepaid",
            "deliveryFee": 5000,
        },
    },
}

INVOICE_JOB = {
    "id": "6f1c2a8e-4b1d-4c55-9a0e-2f7e3c9d1a03",
    "kind": "invoice",
    "payload": {
        "invoiceNumber": "F-0001",
        "invoice": {
            "invoiceNumber": "F-0001",
            "date": "2026-11-04T15:00:52.000Z",
            "businessInfo": {"name": "VIPE Dev", "address": "Calle 1", "phone": "300", "nit": "900"},
            "items": [{"id": "d-1", "name": "Ajiaco", "price": 28000, "quantity": 1}],
            "bill": {"subtotal": 28000, "tax": 0, "taxPercentage": 0, "tip": 0, "tipPercentage": 0,
                     "total": 28000, "totalDiscounts": 0},
            "waiter": "Mesero Dev",
            "table": 4,
            "paymentMethod": "cash",
            "cashReceived": 30000,
            "cashChange": 2000,
        },
        "displayItems": [{"id": "d-1", "name": "Ajiaco", "price": 28000, "quantity": 1}],
    },
}


class FakePrinter:
    """Records raw writes; refuses UTF-8 so negotiation lands on cp1252."""

    def __init__(self, fail=False):
        self.raw = []
        self.fail = fail

    def _raw(self, data):
        if self.fail and data != b"\x1b\x72\x01":
            raise OSError("paper out")
        self.raw.append(data)

    def set(self, **kwargs):
        if kwargs.get("text_encoding") == "utf-8":
            raise ValueError("utf-8 not supported")

    @property
    def ticket(self):
        """Bytes of the ticket itself (the code page probe excluded)."""
        return [data for data in self.raw if data != b"\x1b\x72\x01"]


class FixedDatetime(_datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 11, 4, 15, 0, 52)


def make_handler(**printers):
    return PrintJobHandler(get_printer=lambda kind: printers.get(kind))


class PrintJobHandlerTests(unittest.TestCase):

    def setUp(self):
        patcher = mock.patch.object(print_renderer, "datetime", FixedDatetime)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_command_prints_the_comanda_bytes_and_asks_for_ack(self):
        comandas = FakePrinter()
        handler = make_handler(comandas=comandas)

        self.assertTrue(handler.handle(COMMAND_JOB))

        payload = COMMAND_JOB["payload"]
        expected = print_renderer.build_comanda_bytes({
            "invoiceNumber": payload["invoiceNumber"],
            "table": 4,
            "waiter": "Mesero Dev",
            "items": payload["items"],
            "delivery": None,
        }, encoding="cp1252")
        self.assertEqual(comandas.ticket, [expected])

    def test_command_with_order_number_and_station_prints_the_new_header(self):
        comandas = FakePrinter()
        payload = {**COMMAND_JOB["payload"], "orderNumber": 130, "table": 1, "station": {"id": "s1", "name": "Cocina"}}
        self.assertTrue(make_handler(comandas=comandas).handle({**COMMAND_JOB, "payload": payload}))
        expected = print_renderer.build_comanda_bytes({**payload, "delivery": None}, encoding="cp1252")
        self.assertEqual(comandas.ticket, [expected])
        self.assertIn("COMANDA #130 \u2014 Mesa 1".encode("cp1252"), comandas.ticket[0])
        self.assertIn("Estaci\u00f3n: Cocina".encode("cp1252"), comandas.ticket[0])

    def test_delivery_command_prints_the_delivery_variant(self):
        comandas = FakePrinter()
        self.assertTrue(make_handler(comandas=comandas).handle(DELIVERY_COMMAND_JOB))
        self.assertIn(b"COMANDA \x97 DOMICILIO", comandas.ticket[0])
        self.assertIn(b"Cliente: Luis", comandas.ticket[0])

    def test_invoice_prints_on_the_facturas_printer_with_the_renderer_bytes(self):
        facturas = FakePrinter()
        comandas = FakePrinter()
        handler = make_handler(facturas=facturas, comandas=comandas)

        self.assertTrue(handler.handle(INVOICE_JOB))

        payload = INVOICE_JOB["payload"]
        expected = print_renderer.build_invoice_bytes(
            "F-0001", payload["invoice"], payload["displayItems"], encoding="cp1252"
        )
        self.assertEqual(facturas.ticket, [expected])
        self.assertEqual(comandas.raw, [])

    def test_a_repeated_job_id_prints_once_but_is_acked_again(self):
        comandas = FakePrinter()
        handler = make_handler(comandas=comandas)

        self.assertTrue(handler.handle(COMMAND_JOB))
        # Same job from the pending fetch after a reconnect: no second ticket,
        # but ack again in case the first ack was lost.
        self.assertTrue(handler.handle(COMMAND_JOB))
        self.assertEqual(len(comandas.ticket), 1)

    def test_dedupe_is_by_job_id_not_invoice_number(self):
        facturas = FakePrinter()
        handler = make_handler(facturas=facturas)
        reprint = {**INVOICE_JOB, "id": "6f1c2a8e-4b1d-4c55-9a0e-2f7e3c9d1a04"}

        self.assertTrue(handler.handle(INVOICE_JOB))
        self.assertTrue(handler.handle(reprint))
        self.assertEqual(len(facturas.ticket), 2)

    def test_missing_printer_keeps_the_job_pending_and_retries_later(self):
        handler = make_handler()
        self.assertFalse(handler.handle(COMMAND_JOB))

        comandas = FakePrinter()
        handler.get_printer = lambda kind: comandas if kind == "comandas" else None
        self.assertTrue(handler.handle(COMMAND_JOB))
        self.assertEqual(len(comandas.ticket), 1)

    def test_a_printer_error_keeps_the_job_pending(self):
        broken = FakePrinter(fail=True)
        handler = make_handler(comandas=broken)
        self.assertFalse(handler.handle(COMMAND_JOB))

        working = FakePrinter()
        handler.get_printer = lambda kind: working
        self.assertTrue(handler.handle(COMMAND_JOB))
        self.assertEqual(len(working.ticket), 1)

    def test_unprintable_jobs_are_dropped_with_an_ack(self):
        comandas = FakePrinter()
        handler = make_handler(comandas=comandas, facturas=comandas)
        no_waiter = {**COMMAND_JOB, "id": "j-1", "payload": {**COMMAND_JOB["payload"], "waiter": ""}}
        no_items = {**COMMAND_JOB, "id": "j-2", "payload": {**COMMAND_JOB["payload"], "items": []}}
        no_number = {**INVOICE_JOB, "id": "j-3", "payload": {"invoice": {}, "displayItems": []}}
        unknown_kind = {"id": "j-4", "kind": "label", "payload": {}}

        for job in (no_waiter, no_items, no_number, unknown_kind):
            self.assertTrue(handler.handle(job), job["id"])
        self.assertEqual(comandas.raw, [])

    def test_a_job_without_id_is_ignored(self):
        comandas = FakePrinter()
        handler = make_handler(comandas=comandas)
        self.assertFalse(handler.handle({"kind": "command", "payload": COMMAND_JOB["payload"]}))
        self.assertFalse(handler.handle("not a job"))
        self.assertEqual(comandas.raw, [])

    def test_station_key_ignored_same_bytes(self):
        """F6: facturas tagged with `station` do not change; comandas (S3, comanda-encabezado) only gain `Estación: <name>`."""
        station = {"id": "22222222-2222-2222-2222-222222222222", "name": "Cocina"}
        for job, kind in ((COMMAND_JOB, "comandas"), (DELIVERY_COMMAND_JOB, "comandas"), (INVOICE_JOB, "facturas")):
            tagged = {**job, "payload": {**job["payload"], "station": station}}
            legacy_printer, tagged_printer = FakePrinter(), FakePrinter()
            self.assertTrue(make_handler(**{kind: legacy_printer}).handle(job), job["id"])
            self.assertTrue(make_handler(**{kind: tagged_printer}).handle(tagged), job["id"])
            self.assertTrue(legacy_printer.ticket, job["id"])
            expected = legacy_printer.ticket
            if kind == "comandas":
                line = b"\x1ba\x00" + "Estaci\u00f3n: Cocina".encode("cp1252") + b"\n"
                head, sep, rest = expected[0].partition(b"\x1ba\x00Fecha:")
                expected = [head + line + sep + rest]
            self.assertEqual(tagged_printer.ticket, expected, job["id"])

NOW = _datetime.datetime(2026, 11, 4, 15, 0, 52, tzinfo=_datetime.timezone.utc)


def aged(job, hours):
    created = (NOW - _datetime.timedelta(hours=hours)).isoformat().replace("+00:00", "Z")
    return {**job, "createdAt": created}


class RenderAndAgeTests(unittest.TestCase):

    def test_a_render_error_is_unprintable_acked_and_writes_nothing(self):
        comandas = FakePrinter()
        handler = make_handler(comandas=comandas)
        broken = {**COMMAND_JOB, "id": "j-render", "payload": {**COMMAND_JOB["payload"], "items": ["str"]}}

        with self.assertLogs(print_jobs.logger, "WARNING") as logs:
            self.assertTrue(handler.handle(broken))
        self.assertEqual(comandas.ticket, [])
        self.assertTrue(any("j-render" in line for line in logs.output))

    def test_a_command_older_than_the_cutoff_is_acked_without_printing(self):
        comandas = FakePrinter()
        handler = PrintJobHandler(get_printer=lambda kind: comandas, now=lambda: NOW)
        self.assertEqual(print_jobs.COMMAND_MAX_AGE_HOURS, 12)

        self.assertTrue(handler.handle(aged(COMMAND_JOB, 13)))
        self.assertEqual(comandas.ticket, [])

    def test_a_recent_command_and_an_old_invoice_still_print(self):
        printer = FakePrinter()
        handler = PrintJobHandler(get_printer=lambda kind: printer, now=lambda: NOW)

        self.assertTrue(handler.handle(aged(COMMAND_JOB, 11)))
        self.assertTrue(handler.handle(aged(INVOICE_JOB, 48)))
        self.assertEqual(len(printer.ticket), 2)


class PendingPollingTests(unittest.TestCase):

    def test_poll_is_due_first_then_every_interval(self):
        clock = {"t": 1000.0}
        poller = PendingPoller(interval_seconds=60, clock=lambda: clock["t"])
        self.assertTrue(poller.due())
        poller.fetched()
        clock["t"] += 59
        self.assertFalse(poller.due())
        clock["t"] += 1
        self.assertTrue(poller.due())
        self.assertEqual(poller.seconds_until_due(), 0)

    def test_drain_pages_after_the_last_id_until_a_short_page(self):
        pages = {None: [{"id": f"a{i}"} for i in range(3)], "a2": [{"id": f"b{i}"} for i in range(3)], "b2": [{"id": "c0"}]}
        asked, handled = [], []

        async def fetch_page(after):
            asked.append(after)
            return pages[after]

        async def handle(job):
            handled.append(job["id"])

        asyncio.run(drain_pending(fetch_page, handle, page_size=3))
        self.assertEqual(asked, [None, "a2", "b2"])
        self.assertEqual(handled, ["a0", "a1", "a2", "b0", "b1", "b2", "c0"])

    def test_drain_stops_when_a_page_fails(self):
        async def fetch_page(after):
            return None

        async def handle(job):
            raise AssertionError("nothing to handle")

        asyncio.run(drain_pending(fetch_page, handle, page_size=3))


if __name__ == "__main__":
    unittest.main()
