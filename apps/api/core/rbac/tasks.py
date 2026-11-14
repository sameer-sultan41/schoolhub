"""Registers this app's Celery tasks with the worker.

``app.autodiscover_tasks()`` imports only ``core.rbac.tasks``; the tasks themselves live
with their feature packages. Their names stay ``core.rbac.<feature>.tasks.<name>``, which
``CELERY_TASK_ROUTES`` sends to the ``transactional`` queue.
"""

from core.rbac.invitations.tasks import send_invitation_email
from core.rbac.password_reset.tasks import send_password_changed_email, send_password_reset_email

__all__ = ["send_invitation_email", "send_password_changed_email", "send_password_reset_email"]
