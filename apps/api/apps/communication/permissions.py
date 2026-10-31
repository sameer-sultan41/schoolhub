"""Permission keys for the communication module — docs/03-modules/communication.md §4.

Mirrors that table, with additions §4 needs and did not have — the same
class of gap fees-finance's `fee-structure.view` and `ledger.create` were:
`communication.announcement.view` and `communication.notice.view` are granted
in prose (§7's publication workflow, §8's user journeys — staff reading a draft
before it is published) but §4 lists only create/update/delete/publish for
each. PR C adds three thread gap-fills the same way: `communication.thread.view`
(reading an inbox §8 describes but §4 never keys), `communication.thread.close`
(§7's close/reopen, staff-side only) and `communication.thread.oversee`
(read-only safeguarding access to every thread). Each is registered in the same
PR that ships its endpoints and added to §4's table, per the established
resolution — never invent a key the doc does not mention anywhere.

§4's module verbs `send`, `broadcast` and `acknowledge` were already in
`core/rbac/registry.py`'s `EXTRA_ACTIONS`; `oversee` is the one verb this module
added there.

Guardians and students hold no key for browsing announcements/notices directly
in this plan — they consume via the existing `GET /notifications` inbox
(`core.notifications`), and a guardian-facing browse endpoint is recorded as
parent-portal's (Tier 5) task in this module's §20. `communication.thread.*`
and `communication.notification-preference.update` are the two keys they do
hold, both narrowed by record scope rather than by the key — the same
delegation `fees_finance`'s invoice ownership and `StudentAttendance` use.
"""

from core.rbac.registry import registry

# §3's staff roles who publish/manage communication.
COMMS_STAFF = ("school_admin", "principal", "teacher", "reception")

# §4 — "communication.announcement.create/update/delete … school_admin, teacher
# (scope assigned)". Teachers draft for their own class/section; scope, not the
# key, narrows which announcements a teacher may touch.
ANNOUNCEMENT_AUTHORS = ("school_admin", "teacher")
# The view gap this module fills — see the module docstring.
ANNOUNCEMENT_VIEWERS = COMMS_STAFF
# §4 — "communication.announcement.publish … school_admin, principal".
ANNOUNCEMENT_PUBLISHERS = ("school_admin", "principal")

# §4 — "communication.notice.create/update … school_admin".
NOTICE_AUTHORS = ("school_admin",)
NOTICE_VIEWERS = COMMS_STAFF
# §4 — "communication.notice.publish … principal, school_owner". The approval
# gate: §7's workflow requires the approver differ from the drafter, enforced
# in services, not by this key alone (holding the key is necessary, not
# sufficient — the same shape fees_finance's refund-approval key uses).
NOTICE_PUBLISHERS = ("principal", "school_owner")
# §4 — "communication.notice.acknowledge … guardian, student, staff roles".
NOTICE_ACKNOWLEDGERS = ("guardian", "student", "school_admin", "principal", "teacher", "reception")

# §4 — "communication.broadcast.send … school_owner, principal, school_admin".
# Deliberately narrower than the publishers above: §7 calls broadcast "audited,
# MFA-recommended" and gives it no approval gate, so the permission itself is
# the only mitigation — enforced wherever PR C's broadcast/ package ends up
# sending it, following this module's per-resource-package convention.
BROADCAST_SENDERS = ("school_owner", "principal", "school_admin")

# §4 — "communication.thread.create / communication.message.create … all
# tenant roles (guardian/student scope own)". Every role gets the key; a
# guardian/student's own-child binding is enforced by
# MessageThread.filter_owned_by_user, not by withholding the key.
THREAD_PARTICIPANTS = (
    "school_admin",
    "principal",
    "vice_principal",
    "teacher",
    "class_teacher",
    "reception",
    "it_admin",
    "guardian",
    "student",
)
# Closing/reopening is a staff decision about a conversation — a guardian or
# student cannot close a thread on the school.
THREAD_CLOSERS = tuple(role for role in THREAD_PARTICIPANTS if role not in ("guardian", "student"))
# Read-only access to every thread, not just one's own — the safeguarding
# oversight the user asked for, held by the school's leadership only.
THREAD_OVERSEERS = ("school_owner", "principal")

# §4 — "communication.template.view/update … school_admin, it_admin".
TEMPLATE_MANAGERS = ("school_admin", "it_admin")

# §4 — "communication.delivery-log.view/export … school_admin, it_admin".
DELIVERY_VIEWERS = ("school_admin", "it_admin")

registry.register(
    "communication.announcement.view",
    "View announcements, including drafts and scheduled ones.",
    ANNOUNCEMENT_VIEWERS,
)
registry.register(
    "communication.announcement.create",
    "Draft an announcement.",
    ANNOUNCEMENT_AUTHORS,
)
registry.register(
    "communication.announcement.update",
    "Edit a draft or scheduled announcement.",
    ANNOUNCEMENT_AUTHORS,
)
registry.register(
    "communication.announcement.delete",
    "Delete a draft announcement.",
    ANNOUNCEMENT_AUTHORS,
)
registry.register(
    "communication.announcement.publish",
    "Publish or schedule an announcement, triggering fan-out.",
    ANNOUNCEMENT_PUBLISHERS,
)

registry.register(
    "communication.notice.view",
    "View notices, including drafts and those pending approval.",
    NOTICE_VIEWERS,
)
registry.register(
    "communication.notice.create",
    "Draft a formal notice.",
    NOTICE_AUTHORS,
)
registry.register(
    "communication.notice.update",
    "Edit a draft notice, or return one with comments.",
    NOTICE_AUTHORS,
)
registry.register(
    "communication.notice.publish",
    "Approve and publish a notice, assigning its notice number.",
    NOTICE_PUBLISHERS,
)
registry.register(
    "communication.notice.acknowledge",
    "Acknowledge a notice that requires it.",
    NOTICE_ACKNOWLEDGERS,
)

registry.register(
    "communication.broadcast.send",
    "Send an emergency multi-channel broadcast, bypassing preferences and quiet hours.",
    BROADCAST_SENDERS,
)

registry.register(
    "communication.thread.view",
    "Read the message threads one takes part in.",
    THREAD_PARTICIPANTS,
)
registry.register(
    "communication.thread.create",
    "Start a message thread.",
    THREAD_PARTICIPANTS,
)
registry.register(
    "communication.thread.close",
    "Close or reopen a message thread one takes part in.",
    THREAD_CLOSERS,
)
registry.register(
    "communication.thread.oversee",
    "Read every message thread in the school, audited, without taking part.",
    THREAD_OVERSEERS,
)
registry.register(
    "communication.message.create",
    "Reply within a message thread.",
    THREAD_PARTICIPANTS,
)

registry.register(
    "communication.template.view",
    "View tenant notification template overrides and platform defaults.",
    TEMPLATE_MANAGERS,
)
registry.register(
    "communication.template.update",
    "Create, edit or deactivate a tenant notification template override.",
    TEMPLATE_MANAGERS,
)

registry.register(
    "communication.notification-preference.update",
    "Manage one's own channel preferences.",
    THREAD_PARTICIPANTS,
)

registry.register(
    "communication.delivery-log.view",
    "View the delivery dashboard.",
    DELIVERY_VIEWERS,
)
registry.register(
    "communication.delivery-log.export",
    "Export delivery reports.",
    DELIVERY_VIEWERS,
)
