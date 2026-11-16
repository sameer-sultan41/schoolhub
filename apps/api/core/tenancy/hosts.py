"""Canonical form of a hostname, shared by host resolution and per-host throttling.

Lives in core so `core.rbac.machine` (which may not import an app, ADR-0013) and
`apps.website_cms.hosts` normalise a host identically.
"""

from __future__ import annotations

import re

#: RFC 1035's limit on a full domain name.
MAX_HOSTNAME_LENGTH = 253

# Dot-separated LDH labels (after IDNA encoding), so nothing else reaches a query or a key.
_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_HOSTNAME_RE = re.compile(rf"^{_LABEL}(?:\.{_LABEL})*$")
_PORT_RE = re.compile(r":\d{1,5}$")


def normalise_host(host: str) -> str | None:
    """Lowercase, strip the port and a trailing dot, IDNA-encode; `None` if not a hostname."""
    value = _PORT_RE.sub("", host.strip().lower()).rstrip(".")
    if not value:
        return None
    try:
        value = value.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    if len(value) > MAX_HOSTNAME_LENGTH or not _HOSTNAME_RE.match(value):
        return None
    return value
