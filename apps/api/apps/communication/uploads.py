"""Client-uploadable file purposes owned by this module (core/files/purposes.py).

Declared here, not in a settings dict, so the thread attachment check in
`threads` and the platform's `POST /files` check read from one source.
"""

from core.files.purposes import MEGABYTE, registry

THREAD_ATTACHMENT = registry.register(
    "communication.thread-attachment",
    "A file attached to a message in a communication thread.",
    mime_types={"application/pdf", "image/png", "image/jpeg"},
    max_size_bytes=10 * MEGABYTE,
)
