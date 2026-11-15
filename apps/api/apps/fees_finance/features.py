from core.tenancy.features import registry

registry.register(
    "module.fees_finance",
    "Fees & finance (fee configuration, invoicing, collection, ledger, expenses).",
    default_enabled=False,
)

# AI-FEE-02 (ai.py). Off until a school opts in; the gateway's own `ai.gateway`
# kill switch sits above it (core/ai/features.py).
registry.register(
    "ai.fee-report-summary",
    "AI-generated plain-language summaries of finance reports (AI-FEE-02).",
    default_enabled=False,
)

# Online fee payments through the school's own gateway account (ADR-0034). Off until a
# school has configured its merchant account and chosen to offer it.
registry.register(
    "fees.online-payments",
    "Online fee payments through the school's own payment gateway.",
    default_enabled=False,
)
