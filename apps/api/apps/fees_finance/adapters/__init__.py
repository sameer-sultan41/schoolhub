"""Settlement-file adapters, one per collection provider.

§17 is explicit that this is a **batch file-import adapter and not the
gateway's initiate/callback pattern**: each provider delivers a daily settlement
file in its own layout, and a per-provider adapter normalizes rows before the
matcher sees them. A new provider is a new adapter, never a change to this
module — which is the whole reason the interface exists.

§19 flags the real Easypaisa / JazzCash / partner-bank layouts as unconfirmed
until those agreements are signed, so exactly one adapter ships:
`generic_csv`, over a documented column set. That is enough to prove the
matcher, the match key and the exceptions queue, and it is registered for all
three providers so a real layout replaces one entry rather than restructuring
anything.
"""

# Imported for its side effect: `generic_csv` registers itself on import, the
# way `permissions.py` and `features.py` populate their registries. Without
# this line `adapter_for` raises for every provider — the registry would be
# empty and nothing would say why, since the module exists and looks correct.
from apps.fees_finance.adapters import generic_csv  # noqa: E402,F401  (side effect)
from apps.fees_finance.adapters.base import (
    ParseResult,
    SettlementAdapter,
    SettlementFileRow,
    adapter_for,
    register_adapter,
    registered_providers,
)

__all__ = [
    "ParseResult",
    "SettlementAdapter",
    "SettlementFileRow",
    "adapter_for",
    "register_adapter",
    "registered_providers",
]
