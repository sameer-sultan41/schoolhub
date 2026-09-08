"""Permission keys for the fees-finance module — docs/03-modules/fees-finance.md §4.

Mirrors that table, with two additions §4 needs and does not have. The same
class of gap examinations and attendance both hit: the doc grants a capability
in prose while the table has no row for it, and the resolution is to register
the key **and add the §4 row in the same PR** — never to invent a key the doc
does not mention anywhere.

`fees.fee-structure.view` — granted in prose by §5.1 and §6 ("clone structure
across sessions", "campus-specific structures"), while §4 lists create, update
and delete with no way to *read* one.

`fees.ledger.create` — granted in prose by §5.8 ("posted automatically from
payments, refunds, expenses") and §8's accountant journey, while §4 lists only
`fees.ledger.view`.

**No RBAC registry change ships with this module.** §4's module verbs `collect`,
`refund` and `waive` are already in `core/rbac/registry.py`'s `EXTRA_ACTIONS`,
and everything else is a `STANDARD_ACTION`.

Two scope notes that are easy to get backwards:

* `fees.ledger.create` is granted to `accountant` only, never to `finance_staff`.
  §3 is explicit that finance staff "cannot approve refunds or waivers" and are
  a data-entry role; a manual journal is the one operation that can move money
  between accounts without an invoice or a payment behind it.
* Guardians and students hold no key in this PR. They read invoices and receipts
  through `fees.invoice.view` in PR B, narrowed by *record scope* rather than by
  the key — the same delegation `StudentAttendance` and `Result` use.

Keys arrive with the PR that ships an endpoint for them, so
`tests/test_endpoint_contracts.py` never sees a registered key with nothing
behind it. Registered so far: fee-structure and ledger (PR A); invoice, discount,
scholarship and fine (PR B); payment, refund and their views (PR C).

One more gap key, on the same footing as PR A's two: `fees.discount.view` and
`fees.fine.view` are granted in prose by §3 (a guardian "views children's
invoices, outstanding balance") and §13's discount/fine registers, while §4
lists only the `create` and `waive` halves. A parent who can see a bill but not
the discount that explains it is being shown a number they cannot check.
"""

# §3's finance roles. `accountant` owns the full cycle; `finance_staff` is
# deliberately narrower — data entry, no approvals.
ACCOUNTANTS = ("accountant",)
FINANCE_STAFF = ("accountant", "finance_staff")

# §4 puts fee configuration with the people who set school policy alongside the
# accountant: a structure change repricing a class is an administrative act, not
# a cashier's.
STRUCTURE_AUTHORS = ("school_admin", "accountant")
STRUCTURE_VIEWERS = ("school_admin", "accountant", "finance_staff", "principal", "school_owner")

# §4 — "`fees.ledger.view` … `accountant`, `school_owner`". The owner reads the
# books they are accountable for; nobody else has a reason to read raw journal
# lines, and §13's reports are the shaped view every other role gets.
LEDGER_VIEWERS = ("accountant", "school_owner")

# The portal side of §3's role table. A `student`/`guardian` reads their own
# invoices and their own fines; the *record scope*, not the key, is what narrows
# them — see each model's `filter_owned_by_user`.
PORTAL = ("student", "guardian")
INVOICE_VIEWERS = (
    "accountant",
    "finance_staff",
    "school_admin",
    "school_owner",
    "principal",
    *PORTAL,
)
# Grants and fines are staff-visible plus the family they concern: a parent has
# to be able to see the discount that explains their bill, and the fine that
# explains the rest of it.
GRANT_VIEWERS = ("accountant", "finance_staff", "school_admin", "school_owner", *PORTAL)
# §4 — "`fees.discount.waive` / `fees.fine.waive` … `accountant`,
# `school_owner`". Forgiving money owed is the owner's call or the accountant's;
# §3 is explicit that `finance_staff` "cannot approve refunds or waivers".
WAIVERS = ("accountant", "school_owner")
# §4 — "`fees.refund.approve` … `accountant`, `school_owner`", and §3 is
# explicit that `finance_staff` "cannot approve refunds or waivers". Holding the
# key is not enough on its own: `services.decide_refund` refuses an approver who
# was the requester, because the same person can hold both keys and §7.3's
# segregation is about the *act*, not the grant.
REFUND_APPROVERS = ("accountant", "school_owner")
# Referenced by the module docstring's scope note; keeps ruff from flagging the
# tuple as unused while PR B is what first needs it.
__all__ = [
    "ACCOUNTANTS",
    "FINANCE_STAFF",
    "GRANT_VIEWERS",
    "INVOICE_VIEWERS",
    "LEDGER_VIEWERS",
    "PORTAL",
    "REFUND_APPROVERS",
    "STRUCTURE_AUTHORS",
    "STRUCTURE_VIEWERS",
    "WAIVERS",
]
