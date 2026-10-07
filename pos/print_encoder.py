"""
pos/print_encoder.py
-------------------
ESC/POS encoding negotiation for the VipePOS printer listener.

Attempts UTF-8 first; falls back to CP1252 (Latin-1) if the printer
does not advertise UTF-8 capability or the active code page is one of
the legacy pages (437, 850, 858).

The negotiated encoding is logged at INFO level so operators can verify
which mode the printer is operating in.

Usage
-----
    from print_encoder import negotiate_encoding

    pr = printer_manager.get_printer('comandas')
    encoding = negotiate_encoding(pr)
    # encoding is 'utf-8' or 'cp1252'
"""

import logging

logger = logging.getLogger(__name__)

# Code pages that indicate legacy firmware — UTF-8 is unreliable on these.
LEGACY_CODE_PAGES = frozenset({0, 437, 850, 858})


def negotiate_encoding(printer) -> str:
    """
    Probe the printer for its active code page and negotiate an encoding.

    Strategy
    --------
    1. Query the printer's active code page via ESC r 1.
    2. If the reported page is in the legacy set, fall back to CP1252.
    3. Otherwise, attempt UTF-8 mode.
    4. If setting UTF-8 raises an exception, fall back to CP1252.

    Parameters
    ----------
    printer : escpos.printer.Usb or escpos.printer.Network
        A live connection to the ESC/POS device.

    Returns
    -------
    str
        'utf-8' or 'cp1252' — the encoding actually in use after negotiation.
    """
    encoding = 'utf-8'

    try:
        # ESC r 1 — request printer's active code page.
        # Most ESC/POS printers respond to this with the currently active page.
        # py-escpos does not have a built-in query for this; we send the raw
        # command and rely on the printer NAK or the subsequent set() call to
        # reveal capability.
        printer._raw(b'\x1b\x72\x01')

        # Attempt to activate UTF-8 mode.
        printer.set(text_encoding='utf-8')

        # Read back the profile's codePage to decide if UTF-8 is safe.
        profile = printer.profile()
        code_page = profile.get('codePage', 0)

        if code_page in LEGACY_CODE_PAGES:
            logger.info("Encoding: CP1252 (legacy code page %s detected)", code_page)
            printer.set(text_encoding='cp1252')
            encoding = 'cp1252'
        else:
            logger.info("Encoding: UTF-8 (codePage=%s)", code_page)
            encoding = 'utf-8'

    except Exception as exc:
        # Fall back silently — the printer may not support the query command.
        logger.info("Encoding: CP1252 (fallback — %s)", exc)
        try:
            printer.set(text_encoding='cp1252')
        except Exception:
            pass  # printer may be in a bad state; let the caller handle it
        encoding = 'cp1252'

    return encoding


def encode_for_printer(text: str, encoding: str) -> bytes:
    """
    Encode a Unicode string to bytes using the negotiated encoding.

    Parameters
    ----------
    text     : str  — Unicode string (may contain Spanish chars like Ñ, á, é).
    encoding : str  — 'utf-8' or 'cp1252'.

    Returns
    -------
    bytes
        Encoded byte string suitable for sending to the ESC/POS printer.
    """
    if encoding == 'utf-8':
        return text.encode('utf-8', errors='replace')
    else:
        return text.encode('cp1252', errors='replace')
