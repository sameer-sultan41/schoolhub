"""The permission an export job reads under, carried in its payload as `scope_permission`.

A report export is queued by one request and built later by a worker, which has no
route to ask for a key. So the enqueuing request's declaration travels with the job,
and the task scopes every row by it (`scope_queryset(permission=...)`). It cannot be
derived from the job type: a `GET` over the inline ceiling queues the same job as a
`POST`, under the *view* key rather than the export key, and the file must hold
exactly what that `GET` would have shown.
"""

from __future__ import annotations

from collections.abc import Mapping

from core.rbac.permissions import AnyOf, declared_keys

SCOPE_PERMISSION = "scope_permission"

# A job queued before its payload carried a key. Read under no key it would be empty,
# and under every role's scope it would leak, so it fails and says what to do.
MISSING_SCOPE_PERMISSION = (
    "This export was queued before an update and can no longer be built. Request the export again."
)


def scope_permission_payload(declared: str | AnyOf) -> list[str]:
    """The payload value for ``declared``: its keys, which JSON can carry."""
    return list(declared_keys(declared))


def job_scope_permission(payload: Mapping[str, object]) -> str | AnyOf | None:
    """The declaration a job's payload carries: one key, an `AnyOf` of several, or None."""
    keys = payload.get(SCOPE_PERMISSION)
    if not isinstance(keys, list) or not keys:
        return None
    if not all(isinstance(key, str) and key for key in keys):
        return None
    if len(keys) == 1:
        return str(keys[0])
    return AnyOf(*keys)
