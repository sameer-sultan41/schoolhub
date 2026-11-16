"""§12's `exams.result-approval-pending` reaches the exam's own school only.

`users`, `roles` and `user_roles` have no RLS, so the database does not keep a
holder lookup inside the tenant: the lookup has to filter by tenant itself.
"""

from __future__ import annotations

from apps.examinations import notifications, tasks
from apps.examinations.tests.factories import TenantFactory, UserFactory, grant
from apps.examinations.tests.test_processing import ProcessingTestCase
from core.notifications.models import Notification
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

APPROVE_KEY = "exams.result.approve"


class ResultApprovalNoticeTests(ProcessingTestCase):
    def notified(self) -> set:
        with tenant_context(self.tenant.id):
            return set(
                Notification.objects.filter(
                    event_key=notifications.RESULT_APPROVAL_PENDING, source_id=self.exam.pk
                ).values_list("user_id", flat=True)
            )

    def test_an_approver_in_another_school_is_not_notified(self) -> None:
        self.mark_all("60.00", "70.00", "80.00")
        self.process()
        foreign_approver = UserFactory(tenant=TenantFactory())
        grant(foreign_approver, APPROVE_KEY, scope=RecordScope.ALL)

        tasks.notify_results_pending_approval(
            tenant_id=str(self.tenant.id), exam_id=str(self.exam.pk)
        )

        notified = self.notified()
        self.assertIn(self.user.pk, notified)
        self.assertNotIn(foreign_approver.pk, notified)
