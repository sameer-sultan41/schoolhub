"""Who may act in a thread — the rule each thread service re-checks for itself.

The views resolve a thread through `threads.viewset.visible_threads`; a service
can be called without one (a job, a shell, another service), so it holds the same
two rules again: the caller takes part in the thread, and a guardian or student
still owns the thread's child.
"""

from __future__ import annotations

from django.http import Http404

from apps.communication.models import MessageThread
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
