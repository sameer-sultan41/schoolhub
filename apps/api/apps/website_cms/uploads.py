"""Client-uploadable file purposes owned by the website module (core/files/purposes.py).

Module-gated: the generic `GET /files` never lists website media; the module serves it
through its own endpoints, and the public redirect honours `files.visibility`.
"""

from core.files.purposes import MEGABYTE, registry

WEBSITE_MEDIA = registry.register(
    "website.media",
    "An image used on the school's public website (page sections, news, events, gallery, SEO).",
    mime_types={"image/jpeg", "image/png", "image/webp", "image/gif"},
    max_size_bytes=10 * MEGABYTE,
    module_gated=True,
)
