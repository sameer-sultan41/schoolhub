"""Public media URLs for theme content (plan decision 4).

Visibility itself is `core.files.visibility`; this module only rewrites file references
into the anonymous redirect URL the renderer embeds.
"""

from __future__ import annotations

import copy
from typing import Any
from uuid import UUID

from django.conf import settings

from apps.website_cms.validation import image_slots

PUBLIC_FILE_PATH = "/api/v1/public/files/{tenant_id}/{file_id}"


def public_file_url(tenant_id: UUID, file_id: UUID | str) -> str:
    """The redirect URL for a public file, from `API_PUBLIC_URL` (never the request's Host)."""
    path = PUBLIC_FILE_PATH.format(tenant_id=tenant_id, file_id=file_id)
    return f"{settings.API_PUBLIC_URL.rstrip('/')}{path}"


def url_key(name: str) -> str:
    """`image_file_id` -> `image_url`, `file_id` -> `file_url`, `image` -> `image_url`."""
    for suffix in ("_file_id", "_id"):
        if name.endswith(suffix):
            return f"{name.removesuffix(suffix)}_url"
    return f"{name}_url"


def to_public(schema: dict[str, Any], content: Any, tenant_id: UUID) -> Any:
    """A copy of `content` with each image property `x_file_id` replaced by `x_url`.

    An empty or null reference is dropped without a URL. The input is never mutated. A slot
    reached twice (two `oneOf` branches sharing a property) is rewritten once.
    """
    public = copy.deepcopy(content)
    for _, parent, name in list(image_slots(schema, public)):
        file_id = parent.pop(name, None)
        if file_id:
            parent[url_key(name)] = public_file_url(tenant_id, file_id)
    return public
