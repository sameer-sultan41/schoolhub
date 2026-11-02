"""`replay_or_execute`: a repeated key replays only for the body it was first used with."""

from __future__ import annotations

from unittest import mock

from django.test import TestCase
from rest_framework import status
from rest_framework.response import Response

from apps.school_organization.tests.factories import TenantFactory
from core.idempotency.models import IdempotencyRecord
from core.idempotency.services import IdempotencyKeyReused, replay_or_execute, request_fingerprint
from core.tenancy.context import tenant_context

ENDPOINT = "demo:act"
KEY = "click-1"
BODY = {"message": "School closes at noon.", "audience_type": "all"}


class ReplayOrExecuteTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.execute = mock.Mock(
            side_effect=lambda: Response({"data": {"job_id": "job-1"}}, status=202)
        )

    def call(self, body: object) -> Response:
        with tenant_context(self.tenant.id):
            return replay_or_execute(
                tenant_id=self.tenant.pk,
                key=KEY,
                endpoint=ENDPOINT,
                request_data=body,
                execute=self.execute,
            )

    def test_same_key_and_same_body_replays(self) -> None:
        first = self.call(BODY)
        # The same body with its keys in another order is the same request.
        second = self.call(dict(reversed(list(BODY.items()))))

        self.execute.assert_called_once()
        self.assertEqual(second.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(second.data, first.data)

    def test_same_key_with_a_different_body_is_refused(self) -> None:
        self.call(BODY)

        with self.assertRaises(IdempotencyKeyReused) as raised:
            self.call({**BODY, "message": "Corrected: school closes at one."})

        self.execute.assert_called_once()
        self.assertEqual(raised.exception.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(raised.exception.default_code, "idempotency_key_reused")

    def test_a_row_stored_before_fingerprints_still_replays(self) -> None:
        with tenant_context(self.tenant.id):
            IdempotencyRecord.objects.create(
                tenant=self.tenant,
                key=KEY,
                endpoint=ENDPOINT,
                request_fingerprint="",
                response_status=202,
                response_body={"data": {"job_id": "legacy"}},
            )

        response = self.call({"anything": "at all"})

        self.execute.assert_not_called()
        self.assertEqual(response.data, {"data": {"job_id": "legacy"}})

    def test_the_fingerprint_is_stored_with_the_response(self) -> None:
        self.call(BODY)

        with tenant_context(self.tenant.id):
            record = IdempotencyRecord.objects.get(key=KEY, endpoint=ENDPOINT)
        self.assertEqual(record.request_fingerprint, request_fingerprint(BODY))

    def test_no_key_always_executes(self) -> None:
        with tenant_context(self.tenant.id):
            for _ in range(2):
                replay_or_execute(
                    tenant_id=self.tenant.pk,
                    key=None,
                    endpoint=ENDPOINT,
                    request_data=BODY,
                    execute=self.execute,
                )

        self.assertEqual(self.execute.call_count, 2)
