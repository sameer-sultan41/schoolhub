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

from apps.fees_finance.adapters.base import (
    SettlementAdapter,
    SettlementFileRow,
    adapter_for,
    register_adapter,
)

__all__ = [
    "SettlementAdapter",
    "SettlementFileRow",
    "adapter_for",
    "register_adapter",
]
