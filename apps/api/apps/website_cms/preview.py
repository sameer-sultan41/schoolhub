"""Signed, short-lived page-preview tokens (plan decision 9).

The renderer presents the token in `X-Preview-Token`; the API checks it against the page it
names, so a token for one page or tenant reads nothing else.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from django.core.signing import BadSignature, TimestampSigner, b62_decode

from apps.website_cms.models import WebsitePage

PREVIEW_SALT = "website-preview"
PREVIEW_TOKEN_MAX_AGE = 600


def make_preview_token(page: WebsitePage) -> str:
    return TimestampSigner(salt=PREVIEW_SALT).sign(f"{page.tenant_id}:{page.id}")


def read_preview_token_with_expiry(token: str) -> tuple[UUID, UUID, datetime]:
    """`(tenant_id, page_id, expires_at)`; raises `BadSignature`, or `SignatureExpired` once past.

    `expires_at` is the signed timestamp plus `PREVIEW_TOKEN_MAX_AGE`, in UTC.
    """
    payload = TimestampSigner(salt=PREVIEW_SALT).unsign(token, max_age=PREVIEW_TOKEN_MAX_AGE)
    # `unsign` has verified the signature, so the token is `<payload>:<timestamp>:<signature>`.
    signed_at = datetime.fromtimestamp(b62_decode(token.rsplit(":", 2)[1]), tz=UTC)
    try:
        tenant_id, page_id = payload.split(":")
        return (
            UUID(tenant_id),
            UUID(page_id),
            signed_at + timedelta(seconds=PREVIEW_TOKEN_MAX_AGE),
        )
    except ValueError as exc:
        raise BadSignature("Malformed preview token payload.") from exc


def read_preview_token(token: str) -> tuple[UUID, UUID]:
    """`(tenant_id, page_id)`; raises `BadSignature`, or `SignatureExpired` once past its age."""
    tenant_id, page_id, _ = read_preview_token_with_expiry(token)
    return tenant_id, page_id
