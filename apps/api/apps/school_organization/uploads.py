"""Client-uploadable file purposes owned by this module (core/files/purposes.py)."""

from core.files.purposes import MEGABYTE, registry

# Not module-gated: the logo is shown to everyone who sees the school, so the generic
# `/files` read path (`platform.file.view`, every staff role) reveals nothing private.
SCHOOL_LOGO = registry.register(
    "school.logo",
    "The school's logo, shown in the dashboard and on its public website.",
    mime_types={"image/png", "image/jpeg", "image/webp"},
    max_size_bytes=2 * MEGABYTE,
)
