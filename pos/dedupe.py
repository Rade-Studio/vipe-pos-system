"""
pos/dedupe.py
-------------
Recently-printed LRU cache keyed by invoice number.

Prevents duplicate prints when the Realtime broadcast is re-delivered
within a configurable TTL window (default: 30 seconds, max 256 entries).

Uses ``collections.OrderedDict`` with ``move_to_end`` on hit and
periodic eviction of expired entries.  This matches the design in
``design.md §P5`` and satisfies R5-03 / S5-04 / S5-05.

Usage
-----
    from dedupe import RecentlyPrintedCache

    cache = RecentlyPrintedCache(maxsize=256, ttl_seconds=30.0)

    if cache.should_print("INV-001"):
        printer.print(...)
    # Second call within 30 s returns False — skip duplicate.
"""

import time
from collections import OrderedDict


class RecentlyPrintedCache:
    """
    Sliding-window LRU cache for print deduplication.

    Parameters
    ----------
    maxsize      : int    — maximum entries before oldest is evicted.
    ttl_seconds  : float  — how long a print ticket remains valid.
    """

    def __init__(self, maxsize: int = 256, ttl_seconds: float = 30.0):
        self._cache: OrderedDict[str, float] = OrderedDict()
        self._maxsize = maxsize
        self._ttl = ttl_seconds

    def should_print(self, invoice_number: str) -> bool:
        """
        Decide whether a print for ``invoice_number`` should proceed.

        Returns
        -------
        bool
            ``True``  — no recent print; caller should proceed.
            ``False`` — a print for this invoice happened within the TTL; skip.
        """
        now = time.monotonic()

        # Evict expired entries from the head of the OrderedDict.
        while self._cache:
            oldest_key, oldest_time = next(iter(self._cache.items()))
            if now - oldest_time > self._ttl:
                self._cache.popitem(last=False)
            else:
                break

        if invoice_number in self._cache:
            # Duplicate within TTL — touch to mark recent, skip print.
            self._cache.move_to_end(invoice_number)
            return False

        # New invoice — record timestamp and allow print.
        self._cache[invoice_number] = now

        # Evict oldest if over maxsize.
        if len(self._cache) > self._maxsize:
            self._cache.popitem(last=False)

        return True

    def clear(self) -> None:
        """Clear all entries (mainly for testing)."""
        self._cache.clear()


# Module-level singleton used by handle_comanda / handle_factura in app.py.
recently_printed = RecentlyPrintedCache(maxsize=256, ttl_seconds=30.0)


# ---------------------------------------------------------------------------
# Simple assertions (strict_tdd=false; not pytest)
# ---------------------------------------------------------------------------

def _run_assertions() -> None:
    """Smoke-test the cache without pytest."""
    cache = RecentlyPrintedCache(maxsize=4, ttl_seconds=0.5)

    assert cache.should_print("INV-A") is True,   "first print should proceed"
    assert cache.should_print("INV-A") is False,  "duplicate within TTL should skip"
    assert cache.should_print("INV-B") is True,   "different invoice should proceed"

    # Wait for TTL to expire.
    time.sleep(0.6)
    assert cache.should_print("INV-A") is True,  "after TTL, same invoice allowed again"

    # Eviction when over maxsize.
    big = RecentlyPrintedCache(maxsize=3, ttl_seconds=10.0)
    for i in range(5):
        big.should_print(f"INV-{i}")
    # Only 3 most recent should remain.
    assert len(big._cache) == 3, f"maxsize breach: expected 3, got {len(big._cache)}"

    print("dedupe assertions: all passed")


if __name__ == "__main__":
    _run_assertions()
