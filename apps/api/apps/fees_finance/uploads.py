"""File purposes owned by this module (core/files/purposes.py).

Declared here rather than as bare strings in a task, exactly as permission keys
are declared in `permissions.py` — the structure `core/files/purposes.py` exists
to enforce after three purposes were used by a service and never registered, so
every upload 422'd. Callers reference the returned spec's `.key`, so declaring a
purpose and using one are the same symbol.

`SETTLEMENT_FILE` is genuinely client-uploaded, so its MIME list is the gate
`POST /files` enforces. `RECEIPT` and `VOUCHER` are server-generated —
`create_ready_file` writes them with the bytes already in hand — and registered
anyway, because that helper validates against this same registry and a purpose
invented inline in a Celery task is a purpose nobody can find.
"""

from core.files.purposes import MEGABYTE, registry

RECEIPT = registry.register(
    "fees.receipt",
    "A rendered fee receipt for one payment (§10).",
    mime_types={"application/pdf"},
    max_size_bytes=5 * MEGABYTE,
)

VOUCHER = registry.register(
    "fees.voucher",
    "A rendered bank/wallet payment voucher for one invoice (§10).",
    mime_types={"application/pdf"},
    max_size_bytes=5 * MEGABYTE,
)

SETTLEMENT_FILE = registry.register(
    "fees.settlement-file",
    "A provider settlement file being imported for reconciliation (§7.2).",
    mime_types={
        "text/csv",
        "application/csv",
        "text/plain",
        "application/vnd.ms-excel",
    },
    max_size_bytes=25 * MEGABYTE,
)
