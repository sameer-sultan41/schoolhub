"""Who may see and act in a thread — one definition for the views, services and other apps.

`visible_threads` is the set the inbox, a thread's messages and the parent portal's
unread card all resolve through. A service can be called without it (a job, a
shell, another service), so `assert_thread_participant` holds the same two rules
for one thread: the caller takes part in it, and a guardian or student still owns
the thread's child.
"""

from __future__ import annotations

from django.db.models import Count, IntegerField, OuterRef, Q, QuerySet, Subquery
from django.db.models.functions import Coalesce
from django.http import Http404

from apps.communication.models import Message, MessageThread
from apps.student_management.models import Student


def owns_thread_student(thread: MessageThread, user) -> bool:
    """Whether a guardian or student still owns the child the thread is about."""
    if thread.student_id is None:
        return False
    owned = Student.filter_owned_by_user(Student.objects.alive(), user)
    return owned.filter(pk=thread.student_id).exists()


def assert_thread_participant(thread: MessageThread, user, *, restricted: bool) -> None:
    """404, not 403, to a non-participant or a guardian who no longer owns the child.

    Whether the thread exists is not theirs to learn.
    """
    if not thread.is_participant(user.pk) or (restricted and not owns_thread_student(thread, user)):
        raise Http404("No such thread.")


def visible_threads(user, *, restricted: bool) -> QuerySet[MessageThread]:
    """Threads the caller takes part in — and only those, whatever their role scope.

    Deliberately not `scope_queryset`: membership *is* the authorization
    (ADR-0030). Record scope would show a scope-`all` admin every conversation
    in the school, and hand an `assigned`-scope class teacher nothing, since a
    thread has no section to be assigned through — while the class teacher a
    guardian's thread was routed to must see it. Reading threads one is not part
    of is `communication.thread.oversee`'s separate, audited endpoint.

    A guardian or student must also still own the thread's student: revoking a
    guardian's portal access cuts them off from the conversations about that
    child, not just from the child's record.

    Both viewsets resolve a thread through this one definition, so the inbox, a
    thread's messages and posting into it never disagree about who sees what.
    """
    queryset = MessageThread.participant_filter(MessageThread.objects.alive(), user)
    if restricted:
        owned = Student.filter_owned_by_user(Student.objects.alive(), user)
        queryset = queryset.filter(student__in=owned)
    return queryset


def unread_count(user, *, restricted: bool) -> Coalesce:
    """Messages in the thread the caller neither sent nor has a `read_by` stamp on.

    A guardian or student never sees an internal note, so one cannot be unread
    for them either.

    A correlated subquery, not a `Count` over a join: the join groups every
    visible thread's messages before the page's `LIMIT` applies, while this
    counts only for the rows the page returns, each through the
    `(tenant_id, thread_id, sent_at)` index. No messages to count is 0, not null.
    """
    unread = (
        Message.objects.filter(thread=OuterRef("pk"))
        .exclude(sender_id=user.pk)
        .filter(Q(read_by__isnull=True) | ~Q(read_by__has_key=str(user.pk)))
    )
    if restricted:
        unread = unread.filter(is_internal_note=False)
    per_thread = unread.order_by().values("thread").annotate(unread=Count("pk")).values("unread")
    return Coalesce(Subquery(per_thread, output_field=IntegerField()), 0)


def unread_thread_count(user, *, restricted: bool) -> int:
    """How many of the caller's `visible_threads` hold a message unread by them. One query."""
    return (
        visible_threads(user, restricted=restricted)
        .annotate(unread=unread_count(user, restricted=restricted))
        .filter(unread__gt=0)
        .count()
    )
