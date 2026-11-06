"""Celery queue names for notification delivery — notifications.md §5's lanes.

Plain strings with no Django imports, so `config/settings` can import them for
`CELERY_TASK_ROUTES` without loading any model.
"""

from __future__ import annotations

# The always-warm lane. Every worker definition already consumes it
# (tests/test_celery_routing.py reads them).
EMERGENCY_QUEUE = "emergency"
