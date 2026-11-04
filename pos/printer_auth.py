"""
pos/printer_auth.py
------------------
Connection settings of the printing service (T8c of
odd/tasks/migracion-backend-nestjs.md).

The service authenticates to the VIPE API with a printer token bound to one
restaurant. An admin creates it with ``POST /api/devices/printers`` (the
plaintext ``vpt_...`` value is shown once); the API stores only its sha256.
The token is sent as ``auth: {token}`` in the socket.io handshake and as
``Authorization: Bearer`` on ``/api/print/jobs/*``.

Env vars
--------
VIPE_API_URL        — base URL of the API, e.g. ``https://pos.example.com``
                       or ``http://localhost:4000`` in development.
VIPE_PRINTER_TOKEN  — printer token (``vpt_...``).

In dev mode both come from ``pos/.env`` via python-dotenv. In production
``app.py`` keeps them DPAPI-encrypted under ``%APPDATA%/VipePOS`` and asks for
them on the first run.
"""

import logging
import os

logger = logging.getLogger(__name__)


def resolve_api_url() -> str:
    """Return ``VIPE_API_URL`` without a trailing slash; RuntimeError if unset."""
    url = os.getenv("VIPE_API_URL", "").strip().rstrip("/")
    if not url:
        raise RuntimeError(
            "VIPE_API_URL environment variable is not set. "
            "Set it to the VIPE API base URL (for example http://localhost:4000)."
        )
    return url


def resolve_token() -> str:
    """Return ``VIPE_PRINTER_TOKEN``; RuntimeError if unset or empty."""
    token = os.getenv("VIPE_PRINTER_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "VIPE_PRINTER_TOKEN environment variable is not set. "
            "Create a printer token in the VIPE admin (POST /api/devices/printers) and set it."
        )
    return token


def is_token_configured() -> bool:
    """Return True if a non-empty VIPE_PRINTER_TOKEN is present in the environment."""
    return bool(os.getenv("VIPE_PRINTER_TOKEN", "").strip())
