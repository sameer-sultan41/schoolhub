"""The upload-purpose registry.

Upload purposes are code, not settings. A ``File`` row's ``purpose`` says what the
bytes are for, and ``core.files.services.assert_upload_allowed`` uses it to pick the
allowed MIME types and size ceiling for a client-driven upload.

That used to live in a ``FILE_UPLOAD_RULES`` dict in ``config/settings/base.py``,
one edit away from the module that consumed it — and it drifted: ``staff.photo``,
``staff.document`` and ``staff.qualification`` were used by
``apps.staff_management.services`` but never added to the dict, so ``POST /files``
returned 422 ("Unknown upload purpose") for every staff photo, qualification
certificate and staff document that shipped with PR #30.

The fix is structural rather than a longer dict: a module declares its purposes in
its own ``uploads.py``, exactly the way it declares permission keys in
``permissions.py`` (core/rbac/registry.py) and feature flags in ``features.py``
(core/tenancy/features.py). Services then reference the registered spec's ``key``
instead of retyping the string, so declaring a purpose and using one are the same
symbol and the two cannot drift again.
"""

from __future__ import annotations

from dataclasses import dataclass

MEGABYTE = 1024 * 1024


@dataclass(frozen=True)
class UploadPurposeSpec:
    """One client-uploadable purpose and the limits that apply to it.

    ``mime_types`` is a frozenset so a spec stays hashable and cannot be mutated
    by a caller that got hold of it through ``registry.get()``.
    """

    key: str
    description: str
    mime_types: frozenset[str]
    max_size_bytes: int


class UploadPurposeRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, UploadPurposeSpec] = {}

    def register(
        self,
        key: str,
        description: str,
        *,
        mime_types: set[str] | frozenset[str],
        max_size_bytes: int,
    ) -> UploadPurposeSpec:
        """Declare a purpose. Returns the spec so the caller can hold the symbol.

        The ``module.thing`` shape is checked here for the same reason
        ``PermissionRegistry.register`` checks ``module.resource.action``: a typo
        in a bare string is otherwise invisible until a real upload 422s.
        """
        if key in self._specs:
            raise ValueError(f"Duplicate upload purpose {key!r}")
        if key.count(".") != 1 or not all(part for part in key.split(".")):
            raise ValueError(f"Upload purpose {key!r} must be '<module>.<thing>'")
        if not mime_types:
            raise ValueError(f"Upload purpose {key!r} must allow at least one MIME type")
        if max_size_bytes <= 0:
            raise ValueError(f"Upload purpose {key!r} needs a positive max_size_bytes")

        spec = UploadPurposeSpec(
            key=key,
            description=description,
            mime_types=frozenset(mime_types),
            max_size_bytes=max_size_bytes,
        )
        self._specs[key] = spec
        return spec

    def get(self, key: str) -> UploadPurposeSpec | None:
        return self._specs.get(key)

    def all(self) -> list[UploadPurposeSpec]:
        return sorted(self._specs.values(), key=lambda s: s.key)

    def keys(self) -> set[str]:
        return set(self._specs)

    def __contains__(self, key: str) -> bool:
        return key in self._specs


registry = UploadPurposeRegistry()


def load_module_upload_purposes() -> None:
    """Import every installed app's ``uploads`` module so it self-registers."""
    from django.apps import apps
    from django.utils.module_loading import module_has_submodule

    for config in apps.get_app_configs():
        if module_has_submodule(config.module, "uploads"):
            __import__(f"{config.name}.uploads")
