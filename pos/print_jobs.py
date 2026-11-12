"""
pos/print_jobs.py
-----------------
Handler for the API ``print_job`` events (T8c of
odd/tasks/migracion-backend-nestjs.md).

A job is ``{"id", "kind": "invoice" | "command", "payload"}``. The payloads are
the former Supabase broadcasts, unchanged:

- ``command``: ``{invoiceNumber (the job id), items, waiter, table?, delivery?}``
  printed on the ``comandas`` printer with ``print_renderer.build_comanda_bytes``.
- ``invoice``: ``{invoiceNumber, invoice, displayItems}`` printed on the
  ``facturas`` printer with ``print_renderer.build_invoice_bytes``.

``handle(job)`` returns True when the API should be told the job is done
(``POST /api/print/jobs/<id>/ack``): printed now, printed before (the ack is
idempotent and the first one may have been lost), or unprintable (dropped so
it does not come back on every reconnect). It returns False when the job must
stay pending: no printer configured or a printer I/O error; the next pending
poll retries it. A payload the renderer cannot turn into bytes is unprintable,
and so is a ``command`` older than ``COMMAND_MAX_AGE_HOURS`` (a kitchen ticket
that late would only reach the kitchen in a burst after a long outage);
invoices print at any age.

Dedupe is by job id, so a reprint of the same invoice (a new job) prints again
while a job delivered twice (socket event plus pending fetch) prints once.
Call ``handle`` from one thread at a time.
"""

import logging
import time
from datetime import datetime, timedelta, timezone

from dedupe import RecentlyPrintedCache
from print_encoder import negotiate_encoding
import print_renderer

logger = logging.getLogger(__name__)

PRINTER_BY_KIND = {"command": "comandas", "invoice": "facturas"}

# Commands older than this are acknowledged without printing.
COMMAND_MAX_AGE_HOURS = 12
# GET /api/print/jobs/pending returns at most this many jobs per page.
PENDING_PAGE_SIZE = 500
# Pending jobs are fetched on connect and then every POLL_INTERVAL_SECONDS.
POLL_INTERVAL_SECONDS = 60


class PrintJobHandler:

    def __init__(self, get_printer, printed=None, now=None):
        """
        get_printer : callable(printer_type) -> printer or None
            ``printer_type`` is ``"comandas"`` or ``"facturas"``.
        printed : RecentlyPrintedCache, optional
            Job ids already printed; one day by default.
        now : callable() -> aware datetime, optional
            Clock for the command age cutoff.
        """
        self.get_printer = get_printer
        self.printed = printed or RecentlyPrintedCache(maxsize=2048, ttl_seconds=24 * 3600)
        self.now = now or (lambda: datetime.now(timezone.utc))

    def handle(self, job) -> bool:
        if not isinstance(job, dict) or not isinstance(job.get("id"), str) or not job["id"]:
            logger.warning("print_job without id ignored")
            return False
        job_id = job["id"]
        kind = job.get("kind")
        payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}

        render = _RENDERERS.get(kind)
        raw = render(payload) if render else None
        if raw is None:
            logger.warning("Unprintable print_job %s (%s) dropped", job_id, kind)
            return True

        if kind == "command" and self._older_than(job.get("createdAt"), COMMAND_MAX_AGE_HOURS):
            logger.warning("Command %s older than %s h acknowledged without printing", job_id, COMMAND_MAX_AGE_HOURS)
            return True

        if not self.printed.should_print(job_id):
            logger.info("Duplicate print_job skipped: %s", job_id)
            return True

        printer_type = PRINTER_BY_KIND[kind]
        printer = self.get_printer(printer_type)
        if not printer:
            logger.warning("%s printer not configured; job %s stays pending", printer_type, job_id)
            self.printed.forget(job_id)
            return False

        try:
            encoding = negotiate_encoding(printer)
        except Exception as exc:
            logger.error("Printer error before job %s: %s", job_id, exc)
            self.printed.forget(job_id)
            return False

        # Rendering is not I/O: a payload it cannot render never will.
        try:
            data = raw(encoding)
        except Exception as exc:
            logger.warning("Unprintable print_job %s (%s) dropped: render failed: %s", job_id, kind, exc)
            return True

        try:
            printer._raw(data)
        except Exception as exc:
            logger.error("Failed to print job %s: %s", job_id, exc)
            self.printed.forget(job_id)
            return False

        logger.info("Printed %s job %s", kind, job_id)
        return True

    def _older_than(self, created_at, hours) -> bool:
        if not isinstance(created_at, str):
            return False
        try:
            created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            return False
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return self.now() - created > timedelta(hours=hours)


class PendingPoller:
    """When the next pending fetch is due: at once, then every ``interval_seconds``."""

    def __init__(self, interval_seconds=POLL_INTERVAL_SECONDS, clock=time.monotonic):
        self.interval = interval_seconds
        self.clock = clock
        self.last = None

    def due(self) -> bool:
        return self.seconds_until_due() == 0

    def seconds_until_due(self) -> float:
        if self.last is None:
            return 0
        return max(0, self.interval - (self.clock() - self.last))

    def fetched(self) -> None:
        self.last = self.clock()


async def drain_pending(fetch_page, handle, page_size=PENDING_PAGE_SIZE):
    """
    Fetch every pending job, page by page, and handle each in order.

    fetch_page : async callable(after_id or None) -> list of jobs, or None on error
    handle     : async callable(job)
    A full page continues after its last id, so failing old jobs cannot hide
    newer ones behind the page limit.
    """
    after = None
    while True:
        page = await fetch_page(after)
        if not page:
            return
        for job in page:
            await handle(job)
        if len(page) < page_size:
            return
        after = page[-1]["id"]


def _command(payload):
    invoice_number = payload.get("invoiceNumber")
    items = payload.get("items")
    waiter = payload.get("waiter")
    if not invoice_number or not items or not waiter:
        return None
    order = {
        "invoiceNumber": invoice_number,
        "table": payload.get("table"),
        "waiter": waiter,
        "items": items,
        "delivery": payload.get("delivery"),
    }
    # Comanda header (orderNumber, station, takeaway): passed through only when present.
    for key in ("orderNumber", "station", "takeaway"):
        if payload.get(key) is not None:
            order[key] = payload[key]
    return lambda encoding: print_renderer.build_comanda_bytes(order, encoding=encoding)


def _invoice(payload):
    invoice_number = payload.get("invoiceNumber")
    if not invoice_number:
        return None
    invoice = payload.get("invoice") or {}
    display_items = payload.get("displayItems") or []
    return lambda encoding: print_renderer.build_invoice_bytes(
        invoice_number, invoice, display_items, encoding=encoding
    )


_RENDERERS = {"command": _command, "invoice": _invoice}
