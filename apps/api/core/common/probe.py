"""Deliberate backend violations (scratch branch; never merged)."""

import os

from apps.fees_finance import models  # core importing an app (ADR-0013)
from core.rbac.permissions import has_permission_key

API_KEY = os.environ.get("PROBE_KEY")  # os.environ outside settings (TID251)


def probe(user):
    try:
        return has_permission_key(user, "probe.not.registered")  # unregistered inline key
    except Exception:  # noqa: BLE001  (a NEW baseline entry: lint passes, lint-baselines fails)
        return models
