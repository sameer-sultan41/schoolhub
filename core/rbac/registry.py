"""The permission-key registry.

Permission keys are code, not data: each module app declares its keys here (or in
its own ``permissions.py`` which registers into this registry at app-ready time).
A migration seeds the database ``permissions`` table from the registry, so the two
can never drift — tests/test_permission_registry.py asserts equality.

Key format: ``module.resource.action`` — see docs/02-architecture/auth-and-rbac.md §2.1.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Standard action vocabulary. Module-specific verbs must be declared in the module's
# own doc §4 and added to EXTRA_ACTIONS so the format check stays meaningful.
STANDARD_ACTIONS = frozenset(
    {"view", "create", "update", "delete", "export", "import", "approve", "publish"}
)

EXTRA_ACTIONS = frozenset(
    {
        "mark", "issue", "lock", "collect", "refund", "waive", "send", "broadcast",
        "acknowledge", "return", "renew", "assign", "receive", "adjust", "dispose",
        "generate", "verify", "enroll", "withdraw", "activate", "close", "execute",
        "convert", "run", "query", "provision", "suspend", "reinstate", "impersonate",
        "request", "revoke",
    }
)

ALL_ACTIONS = STANDARD_ACTIONS | EXTRA_ACTIONS


@dataclass(frozen=True)
class PermissionSpec:
    key: str
    description: str = ""
    default_roles: tuple[str, ...] = field(default_factory=tuple)

    @property
    def module(self) -> str:
        return self.key.split(".")[0]

    @property
    def resource(self) -> str:
        return self.key.split(".")[1]

    @property
    def action(self) -> str:
        return self.key.split(".")[2]


class PermissionRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, PermissionSpec] = {}

    def register(self, key: str, description: str = "", default_roles=()) -> PermissionSpec:
        parts = key.split(".")
        if len(parts) != 3:
            raise ValueError(f"Permission key must be module.resource.action, got {key!r}")
        module, resource, action = parts
        if action not in ALL_ACTIONS:
            raise ValueError(
                f"Unknown action {action!r} in {key!r}. Add it to EXTRA_ACTIONS and to the "
                f"module doc §4 if it is genuinely a new verb."
            )
        if key in self._specs:
            raise ValueError(f"Duplicate permission key {key!r}")
        spec = PermissionSpec(key=key, description=description, default_roles=tuple(default_roles))
        self._specs[key] = spec
        return spec

    def register_crud(self, module: str, resource: str, *, default_roles=(), actions=None):
        """Convenience for the common view/create/update/delete set."""
        for action in actions or ("view", "create", "update", "delete"):
            self.register(f"{module}.{resource}.{action}", default_roles=default_roles)

    def all(self) -> list[PermissionSpec]:
        return sorted(self._specs.values(), key=lambda s: s.key)

    def keys(self) -> set[str]:
        return set(self._specs)

    def for_module(self, module: str) -> list[PermissionSpec]:
        return [s for s in self.all() if s.module == module]

    def __contains__(self, key: str) -> bool:
        return key in self._specs


registry = PermissionRegistry()


def load_module_permissions() -> None:
    """Import every installed app's ``permissions`` module so it self-registers."""
    from django.apps import apps
    from django.utils.module_loading import module_has_submodule

    for config in apps.get_app_configs():
        if module_has_submodule(config.module, "permissions"):
            __import__(f"{config.name}.permissions")
