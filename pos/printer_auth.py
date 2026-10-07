"""
pos/printer_auth.py
------------------
Service-role token resolution for the printer listener's Realtime connection.

Design (Q5-A)
-------------
Token is resolved via env var ``VIPE_PRINTER_TOKEN`` at boot.
Full dynamic rotation (GoTrue admin endpoint at boot + 24 h background rotation)
is the follow-up to this slice.

This module ships the interface only:
  - ``resolve_token()`` reads ``VIPE_PRINTER_TOKEN`` from the environment.
  - A ``TokenProvider`` protocol is defined so the dynamic-rotator implementation
    (follow-up) can be swapped in without changing call sites.

Env vars
--------
VIPE_PRINTER_TOKEN  — service-role JWT for the printer listener station.
                       In dev mode this is loaded from ``.env`` via python-dotenv.
                       In production it should be injected by the installer or
                       a secret-management tool (Windows Credential Manager, etc.).

Usage
-----
    from printer_auth import resolve_token

    token = resolve_token()   # raises RuntimeError if not set
    # token is passed to AsyncRealtimeClient params=... and headers=...
"""

import logging
import os

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Token resolution
# ---------------------------------------------------------------------------

def resolve_token() -> str:
    """
    Resolve the service-role JWT from the environment.

    Returns
    -------
    str
        The service-role token string.

    Raises
    ------
    RuntimeError
        If ``VIPE_PRINTER_TOKEN`` is not set or is empty.
    """
    token = os.getenv("VIPE_PRINTER_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "VIPE_PRINTER_TOKEN environment variable is not set. "
            "Set it to a valid Supabase service-role JWT before starting the listener."
        )
    return token


def is_token_configured() -> bool:
    """Return True if a non-empty VIPE_PRINTER_TOKEN is present in the environment."""
    return bool(os.getenv("VIPE_PRINTER_TOKEN", "").strip())
