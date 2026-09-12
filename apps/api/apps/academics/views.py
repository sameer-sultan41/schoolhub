"""Shared view-layer surface for the academics module.

Deliberately kept at the app root — ``FEATURE`` is used by every viewset in
every one of the three resource packages (``curriculum/``,
``teacher_allocations/``, ``promotions/`` — see docs/03-modules/academics.md
§20).
"""

from __future__ import annotations

FEATURE = "module.academics"
