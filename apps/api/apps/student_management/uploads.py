"""Client-uploadable file purposes owned by this module (core/files/purposes.py)."""

from core.files.purposes import MEGABYTE, registry

IMAGE_MIME_TYPES = {"image/jpeg", "image/png"}
DOCUMENT_MIME_TYPES = {"image/jpeg", "image/png", "application/pdf"}

STUDENT_PHOTO = registry.register(
    "student.photo",
    "Student profile photograph, also printed on ID cards.",
    mime_types=IMAGE_MIME_TYPES,
    max_size_bytes=5 * MEGABYTE,
)

STUDENT_DOCUMENT = registry.register(
    "student.document",
    "A student document (birth certificate, transfer certificate, medical note).",
    mime_types=DOCUMENT_MIME_TYPES,
    max_size_bytes=10 * MEGABYTE,
)

GUARDIAN_PHOTO = registry.register(
    "guardian.photo",
    "Guardian photograph, shown on the guardian record and gate passes.",
    mime_types=IMAGE_MIME_TYPES,
    max_size_bytes=5 * MEGABYTE,
)
