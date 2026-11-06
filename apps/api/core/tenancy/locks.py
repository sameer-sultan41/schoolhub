"""Transaction-scoped PostgreSQL advisory locks, shared across modules.

Session-level advisory locks are prohibited under PgBouncer transaction pooling
(database-architecture.md §1.1); `pg_advisory_xact_lock` releases itself at
commit or rollback, so it is the only form application code takes.

The two-int form keys a lock as (namespace, key). Postgres keeps that key space
apart from the single-bigint form, and each namespace below is declared once,
so two modules can never pick the same lock by accident.
"""

from __future__ import annotations

import hashlib
import uuid
from enum import IntEnum

from django.db import connection, transaction


class AdvisoryLockNamespace(IntEnum):
    """One value per lock purpose. Never renumber a member; add a new one."""

    # Every exam sitting write and `:publish-schedule` in one school (examinations).
    EXAM_SCHEDULE = 1


def advisory_lock_key(key: uuid.UUID) -> int:
    """A stable non-negative int4 for `key`.

    Two keys sharing a hash only serialise needlessly; they never skip a lock.
    Non-negative so the value renders the same in SQL as in Python.
    """
    digest = hashlib.blake2b(key.bytes, digest_size=4).digest()
    return int.from_bytes(digest, byteorder="big") & 0x7FFFFFFF


def advisory_xact_lock(namespace: AdvisoryLockNamespace, key: uuid.UUID) -> None:
    """Block until this transaction holds the (namespace, key) advisory lock.

    Must run inside a transaction: outside one the lock would release at once.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("advisory_xact_lock() must run inside transaction.atomic().")
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(%s, %s)", [int(namespace), advisory_lock_key(key)]
        )
