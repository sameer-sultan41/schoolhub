"""Serializer helpers shared by every module.

**`users(id)` names, one query per response.** Audit-style columns —
`requested_by`, `approver_id`, `submitted_by` — are plain UUID columns rather
than foreign keys (a user row is platform-level, and a module table holding a
real FK to it would couple every module's deletes to the auth tables), so
there is nothing to `select_related`. Resolving each one in its own field
would cost a user query per row per column. `UserNamesModelSerializer` and
`UserNamesListSerializer` collect a whole response's ids first and load them
in one pass, kept in the root serializer's context.

Hoisted from `apps/attendance/serializers.py`, where it was first written for
leave and correction approvals, so the next module showing an approver's name
reuses the one pass instead of growing a second copy of it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import models
from rest_framework import serializers

from core.rbac.models import User

if TYPE_CHECKING:
    import uuid
    from collections.abc import Iterable

# The serializer context key that carries one response's `users(id) -> name` map.
USER_NAMES_CONTEXT_KEY = "user_names"


def _load_user_names(context: dict, user_ids: Iterable[uuid.UUID | None]) -> dict:
    """Names for every id not loaded yet, in one query, kept in the root's context.

    An unknown id maps to None and is not asked for again. So does a nameless
    user: `get_full_name` would fall back to their email, which a co-guardian or
    a parent must not see.
    """
    names = context.setdefault(USER_NAMES_CONTEXT_KEY, {})
    missing = {user_id for user_id in user_ids if user_id is not None and user_id not in names}
    if missing:
        users = User.objects.filter(pk__in=missing).only("id", "first_name", "last_name")
        names.update(
            {user.pk: f"{user.first_name} {user.last_name}".strip() or None for user in users}
        )
        names.update({user_id: None for user_id in missing if user_id not in names})
    return names


def _names_preloaded(serializer: serializers.BaseSerializer) -> bool:
    """Whether an enclosing serializer already loaded this one's names.

    A row of a `UserNamesListSerializer` was covered by that list's pass, and a
    serializer nested in a `UserNamesModelSerializer` by that row's `user_ids`, so
    each skips its own pass over ids that are already in the context.
    """
    return isinstance(serializer.parent, UserNamesListSerializer | UserNamesModelSerializer)


class UserNamesListSerializer(serializers.ListSerializer):
    """Loads every row's user names in one query before the rows render."""

    def to_representation(self, data):
        rows = list(data.all() if isinstance(data, models.manager.BaseManager) else data)
        if not _names_preloaded(self):
            _load_user_names(
                self.context, (uid for row in rows for uid in self.child.user_ids(row))
            )
        return super().to_representation(rows)


class UserNamesModelSerializer(serializers.ModelSerializer):
    """`*_name` fields for `users(id)` columns: first and last name, never the email.

    A subclass lists its ids in `user_ids` and sets `UserNamesListSerializer` as its
    `Meta.list_serializer_class`, so a page costs one user query, not one per row.
    A parent nesting another of these lists the nested rows' ids in its own
    `user_ids` too (attendance's `LeaveRequestSerializer`): the nested pass is skipped.
    """

    def user_ids(self, instance) -> Iterable[uuid.UUID | None]:
        raise NotImplementedError

    def user_name(self, user_id: uuid.UUID | None) -> str | None:
        if user_id is None:
            return None
        names = self.context.get(USER_NAMES_CONTEXT_KEY, {})
        if user_id not in names:
            names = _load_user_names(self.context, [user_id])
        return names[user_id]

    def to_representation(self, instance):
        if not _names_preloaded(self):
            _load_user_names(self.context, self.user_ids(instance))
        return super().to_representation(instance)
