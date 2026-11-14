"""Password-reset emails, on the ``transactional`` queue (``core.rbac.*.tasks.*``).

The reset request passes the tenant and the typed address; the lookup and the token both
happen here, so the request endpoint answers the same way for every address.
"""

from __future__ import annotations

import uuid

from celery import shared_task

from core.rbac.auth_emails import MAX_EMAIL_RETRIES, TRANSIENT_EMAIL_ERRORS
from core.rbac.password_reset import services
from core.tenancy.tasks import TenantAwareTask


@shared_task(
    base=TenantAwareTask,
    bind=True,
    autoretry_for=TRANSIENT_EMAIL_ERRORS,
    max_retries=MAX_EMAIL_RETRIES,
    retry_backoff=True,
)
def send_password_reset_email(self, *, tenant_id: str, email: str) -> bool:
    return services.deliver_password_reset(tenant_id=uuid.UUID(tenant_id), email=email)


@shared_task(
    base=TenantAwareTask,
    bind=True,
    autoretry_for=TRANSIENT_EMAIL_ERRORS,
    max_retries=MAX_EMAIL_RETRIES,
    retry_backoff=True,
)
def send_password_changed_email(self, *, tenant_id: str, user_id: str) -> bool:
    return services.deliver_password_changed(
        tenant_id=uuid.UUID(tenant_id), user_id=uuid.UUID(user_id)
    )
