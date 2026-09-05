"""Client-uploadable file purposes owned by this module (core/files/purposes.py).

These three shipped in PR #30 without a matching entry in the old
``settings.FILE_UPLOAD_RULES`` dict, so every staff upload 422'd at ``POST /files``.
Declaring them here is what makes the module's own ``assert_file_usable`` calls and
the platform's upload check read from one source.
"""

from core.files.purposes import MEGABYTE, registry

STAFF_PHOTO = registry.register(
    "staff.photo",
    "Staff profile photograph.",
    mime_types={"image/jpeg", "image/png"},
    max_size_bytes=5 * MEGABYTE,
)

STAFF_DOCUMENT = registry.register(
    "staff.document",
    "A staff document (contract, CNIC, police verification).",
    mime_types={"image/jpeg", "image/png", "application/pdf"},
    max_size_bytes=10 * MEGABYTE,
)

STAFF_QUALIFICATION = registry.register(
    "staff.qualification",
    "A qualification certificate attached to a staff qualification record.",
    mime_types={"image/jpeg", "image/png", "application/pdf"},
    max_size_bytes=10 * MEGABYTE,
)
