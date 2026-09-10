"""`TYPE_CHECKING`-only base for the per-action mixin classes under each
resource's `views/` package (e.g. `notices.views.submit.SubmitActionMixin`).

Every action mixin is only ever combined with a real `GenericAPIView`
subclass at runtime, via multiple inheritance in the resource's own
`viewset.py` — never instantiated standalone. mypy has no way to see that
from the mixin's own file alone, and flags `self.get_object()`/
`self.get_serializer()` as undefined. `rest_framework` already has no type
stubs in this project (`ignore_missing_imports` in `pyproject.toml`), so
inheriting from `ActionMixinBase` under `TYPE_CHECKING` only silences that
false positive without changing anything at runtime — this is `object`
whenever the module is actually imported.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rest_framework.generics import GenericAPIView

    ActionMixinBase = GenericAPIView
else:
    ActionMixinBase = object
