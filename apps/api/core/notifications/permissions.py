"""Permission key owned by core.notifications.

The inbox is platform infrastructure, like `platform.job.view`: every tenant role
reads its own notifications, whatever modules the school has on. The key gates
reaching the endpoint; which rows come back is the caller's own, by membership
(see `NotificationInboxViewSet.get_queryset`), never by record scope.
"""

from core.rbac.registry import registry
from core.rbac.roles import ALL_TENANT_ROLES

#: The one definition; the inbox view and the e2e seed import it.
NOTIFICATION_VIEW = "platform.notification.view"

registry.register(
    NOTIFICATION_VIEW,
    "Read, and mark read, the caller's own in-app notifications (core platform infrastructure).",
    ALL_TENANT_ROLES,
)
