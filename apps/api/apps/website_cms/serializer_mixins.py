"""Serializer mixins for the module's request bodies."""

from __future__ import annotations


# Not a docstring: drf-spectacular copies a serializer's docstring into the schema.
# Keeps a request serializer's schema non-partial on a PATCH route. drf-spectacular marks a
# PATCH body `partial`, emitting a `Patched...` component with every field optional; for the
# bulk-replace and reorder routes the whole body is required and the views validate it
# non-partial, so the documented contract must say so too.
class FullBodyMixin:
    @property
    def partial(self) -> bool:
        return False

    @partial.setter
    def partial(self, value: bool) -> None:
        # Ignore the write: BaseSerializer.__init__ and drf-spectacular both assign it.
        pass
