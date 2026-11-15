"""Celery tasks for the website module."""

from __future__ import annotations

import hashlib
import hmac
import http.client
import json
import logging
from urllib.parse import urlsplit
from uuid import UUID

from celery import shared_task
from django.conf import settings

from core.tenancy.maintenance import for_each_tenant
from core.tenancy.tasks import TenantAwareTask

logger = logging.getLogger(__name__)

REVALIDATE_TIMEOUT_SECONDS = 5
REVALIDATE_MAX_RETRIES = 5
REVALIDATE_BACKOFF_MAX_SECONDS = 300
SIGNATURE_HEADER = "x-schoolhub-signature"


class RevalidationFailed(OSError):
    """The renderer was unreachable or answered 5xx; `OSError` so the task retries it."""


def _post(url: str, body: bytes, headers: dict[str, str]) -> int:
    """POST `body` and return the status. Stdlib `http.client`: the API has no other client."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("WEBSITE_REVALIDATE_URL must be an absolute http(s) URL.")
    connection_class = (
        http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    )
    connection = connection_class(parts.hostname, parts.port, timeout=REVALIDATE_TIMEOUT_SECONDS)
    try:
        target = parts.path or "/"
        if parts.query:
            target = f"{target}?{parts.query}"
        connection.request("POST", target, body=body, headers=headers)
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


@shared_task(
    name="website_cms.revalidate_website",
    # `HTTPException` covers a malformed or truncated response, which `OSError` does not.
    autoretry_for=(OSError, http.client.HTTPException),
    retry_backoff=True,
    retry_backoff_max=REVALIDATE_BACKOFF_MAX_SECONDS,
    retry_jitter=True,
    max_retries=REVALIDATE_MAX_RETRIES,
)
def revalidate_website(tenant_id: str, tags: list[str]) -> None:
    """Tell the renderer to drop a tenant's cached pages (plan decision 8).

    The body is signed with HMAC-SHA256 under the shared secret, as `apps/website`'s
    `/api/revalidate` expects. No URL configured is a no-op; a URL with no secret fails
    closed, because the renderer would reject every request.
    """
    url = settings.WEBSITE_REVALIDATE_URL
    if not url:
        return
    secret = settings.WEBSITE_REVALIDATE_SECRET
    if not secret:
        logger.error("WEBSITE_REVALIDATE_URL is set but WEBSITE_REVALIDATE_SECRET is empty")
        return
    body = json.dumps({"tenant_id": str(tenant_id), "tags": list(tags)}).encode()
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    status = _post(url, body, {"Content-Type": "application/json", SIGNATURE_HEADER: signature})
    if status >= 500:
        raise RevalidationFailed(f"renderer answered {status}")
    if status >= 400:
        # A 4xx is a configuration fault (bad secret, wrong URL); retrying cannot fix it.
        logger.error("website revalidation rejected with %s for tenant %s", status, tenant_id)


@shared_task(base=TenantAwareTask, name="website_cms.notify_contact_received")
def notify_contact_received(*, tenant_id: str, submission_id: str) -> None:
    """Notify staff of a stored contact submission (queued on commit by its service)."""
    from apps.website_cms import notifications
    from apps.website_cms.models import ContactSubmission
    from core.tenancy.context import tenant_atomic

    with tenant_atomic(UUID(tenant_id)):
        rows = ContactSubmission.objects.alive().select_related("tenant")
        submission = rows.filter(pk=submission_id).first()
        if submission is not None and not notifications.already_notified(submission):
            notifications.notify_contact_received(submission)


@shared_task(name="website_cms.reverify_custom_domains")
def reverify_custom_domains() -> dict[str, int]:
    """Every 15 minutes: re-check each school's custom-domain claims of the last 72 hours.

    Non-atomic per tenant: DNS runs with no transaction open, and each result is written in
    its own `tenant_atomic` (ADR-0034).
    """
    # Imported here: the services import revalidation, which imports this module.
    from apps.website_cms.custom_domains.services import reverify_tenant_domains

    return for_each_tenant(reverify_tenant_domains, job="website-domain-reverify", atomic=False)


@shared_task(name="website_cms.recheck_active_custom_domains")
def recheck_active_custom_domains() -> dict[str, int]:
    """Daily: re-verify active domains; three failures in a row lapse one to `failed`."""
    from apps.website_cms.custom_domains.services import recheck_tenant_active_domains

    return for_each_tenant(
        recheck_tenant_active_domains, job="website-domain-recheck", atomic=False
    )
