"""Celery application.

Tasks run with the initiating user's tenant context, never a superuser context —
see core/tenancy/tasks.py for the base task that enforces this.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("schoolhub")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
