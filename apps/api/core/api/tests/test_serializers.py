"""Tests for `core.api.serializers`' one-query user-name resolution.

`BackgroundJob.created_by` is the fixture: a plain `users(id)` column on a
core-owned table, which is exactly the shape the mixin exists for, and it keeps
these tests free of any module's models.
"""

from __future__ import annotations

from rest_framework import serializers
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.api.serializers import UserNamesListSerializer, UserNamesModelSerializer
from core.jobs.models import BackgroundJob
from core.jobs.tests.factories import BackgroundJobFactory
from core.tenancy.context import tenant_context


class JobCreatorSerializer(UserNamesModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BackgroundJob
        fields = ("id", "created_by_name")
        list_serializer_class = UserNamesListSerializer

    def user_ids(self, instance):
        return [instance.created_by]

    def get_created_by_name(self, job) -> str | None:
        return self.user_name(job.created_by)


class UserNamesModelSerializerTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()

    def job_by(self, user):
        with tenant_context(self.tenant.id):
            return BackgroundJobFactory(
                tenant=self.tenant, created_by=user.pk if user is not None else None
            )

    def test_a_single_object_resolves_its_name_in_one_query(self) -> None:
        job = self.job_by(UserFactory(tenant=self.tenant, first_name="Hina", last_name="Malik"))

        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            data = JobCreatorSerializer(job).data

        self.assertEqual(data["created_by_name"], "Hina Malik")

    def test_a_list_resolves_every_row_in_one_query(self) -> None:
        jobs = [
            self.job_by(UserFactory(tenant=self.tenant, first_name=f"User{n}", last_name="Khan"))
            for n in range(3)
        ]

        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            data = JobCreatorSerializer(jobs, many=True).data

        self.assertEqual(
            [row["created_by_name"] for row in data], [f"User{n} Khan" for n in range(3)]
        )

    def test_a_nameless_user_is_none_never_their_email(self) -> None:
        job = self.job_by(UserFactory(tenant=self.tenant, first_name="", last_name=""))

        with tenant_context(self.tenant.id):
            data = JobCreatorSerializer(job).data

        self.assertIsNone(data["created_by_name"])

    def test_a_null_id_costs_no_query(self) -> None:
        job = self.job_by(None)

        with tenant_context(self.tenant.id), self.assertNumQueries(0):
            data = JobCreatorSerializer(job).data

        self.assertIsNone(data["created_by_name"])
