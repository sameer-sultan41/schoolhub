"""Signed, short-lived page-preview tokens (plan decision 9).

The renderer presents the token in `X-Preview-Token`; the API checks it against the page it
names, so a token for one page or tenant reads nothing else.
"""

from __future__ import annotations

from uuid import UUID

from django.core.signing import BadSignature, TimestampSigner

from apps.website_cms.models import WebsitePage

PREVIEW_SALT = "website-preview"
PREVIEW_TOKEN_MAX_AGE = 600


def make_preview_token(page: WebsitePage) -> str:
    return TimestampSigner(salt=PREVIEW_SALT).sign(f"{page.tenant_id}:{page.id}")


def read_preview_token(token: str) -> tuple[UUID, UUID]:
    """`(tenant_id, page_id)`; raises `BadSignature`, or `SignatureExpired` once past its age."""
    payload = TimestampSigner(salt=PREVIEW_SALT).unsign(token, max_age=PREVIEW_TOKEN_MAX_AGE)
    try:
        tenant_id, page_id = payload.split(":")
        return UUID(tenant_id), UUID(page_id)
    except ValueError as exc:
        raise BadSignature("Malformed preview token payload.") from exc
