"""Client-uploadable file purposes owned by this module (core/files/purposes.py)."""

from core.files.purposes import MEGABYTE, registry

# .docx, spelled out so the long vendor MIME type does not fight the line limit.
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

SYLLABUS = registry.register(
    "academics.syllabus",
    "Syllabus document attached to a class-subject curriculum row.",
    mime_types={"application/pdf", DOCX},
    max_size_bytes=20 * MEGABYTE,
)
