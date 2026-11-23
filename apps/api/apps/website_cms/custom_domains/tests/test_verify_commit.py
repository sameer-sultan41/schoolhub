"""`:verify` as production runs it: a bearer token, no session, real transactions (L68).

The route is `non_atomic_requests`, so DNS runs with no transaction open (ADR-0034). Under
`TestCase` the test-wide transaction would hide both that and a missing `tenant_atomic`, so
this uses a `TransactionTestCase` and the token alone.
"""

from __future__ import annotations

from unittest import mock

from django.db import transaction
from rest_framework.test import APITransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.website_cms.custom_domains.adapters import DnsCheck
from apps.website_cms.features import FEATURE
from apps.website_cms.hosts import resolve_host
from apps.website_cms.models import CustomDomain, CustomDomainRoute, CustomDomainStatus
from apps.website_cms.tests.factories import (
    CustomDomainFactory,
    TenantFactory,
    UserFactory,
    enable_feature,
    grant,
)
from core.tenancy.context import tenant_atomic


class RecordingVerifier:
    """Notes whether a transaction was open when DNS would have been asked."""

    def __init__(self) -> None:
        self.in_transaction: list[bool] = []

    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        self.in_transaction.append(transaction.get_connection().in_atomic_block)
        return DnsCheck(True)


class VerifyCommitTests(APITransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        # `tenant_atomic`, not `tenant_context`: outside a transaction RLS would refuse the writes.
        with tenant_atomic(self.tenant.id):
            enable_feature(self.tenant, FEATURE)
            user = UserFactory(tenant=self.tenant)
            grant(user, "website.custom-domain.update")
            self.row = CustomDomainFactory(tenant=self.tenant, domain="www.greenfield.example")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")

    def test_verify_runs_outside_transaction(self) -> None:
        verifier = RecordingVerifier()
        with mock.patch(
            "apps.website_cms.custom_domains.services.get_dns_verifier", return_value=verifier
        ):
            response = self.client.post(f"/api/v1/custom-domains/{self.row.id}:verify")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(verifier.in_transaction, [False])
        # Each step committed on its own: a fresh transaction sees the activation and route.
        with tenant_atomic(self.tenant.id):
            self.assertEqual(
                CustomDomain.objects.get(pk=self.row.id).status, CustomDomainStatus.ACTIVE
            )
        self.assertTrue(CustomDomainRoute.objects.filter(custom_domain_id=self.row.id).exists())
        self.assertEqual(resolve_host("www.greenfield.example"), self.tenant)
