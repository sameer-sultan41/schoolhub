"""The AI gateway: the one path from this platform to an LLM provider.

Every AI feature calls ``core.ai.service.run_feature``. It checks the kill switches,
the budgets and the provider configuration, calls the provider through its adapter
(``core.ai.providers``, the only code that imports a provider SDK), validates what
comes back, and writes exactly one append-only ``AIRequest`` row per call
(docs/02-architecture/ai-architecture.md, docs/04-ai/ai-governance.md).

A module declares its features in its own ``ai.py``, the way it declares permission
keys in ``permissions.py``; ``load_module_ai`` imports them when the app is ready.
"""
