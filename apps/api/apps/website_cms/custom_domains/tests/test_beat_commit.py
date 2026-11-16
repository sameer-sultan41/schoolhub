"""The 15-minute sweep as the worker runs it: real transactions, no request (ADR-0034).

Under `TestCase` the test-wide transaction would make every DNS call look like it ran inside
one, so this uses a `TransactionTestCase`.
"""

from __future__ import annotations

from unittest import mock

from django.db import transaction
from django.test import TransactionTestCase

from apps.website_cms import tasks
from apps.website_cms.custom_domains.adapters import PASSED, DnsCheck
from apps.website_cms.features import FEATURE
from apps.website_cms.models import CustomDomain, CustomDomainRoute, CustomDomainStatus
from apps.website_cms.tests.factories import CustomDomainFactory, TenantFactory, enable_feature
from core.tenancy.context import tenant_atomic

SERVICES = "apps.website_cms.custom_domains.services"


class RecordingVerifier:
    def __init__(self) -> None:
        self.in_transaction: list[bool] = []

    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        self.in_transaction.append(transaction.get_connection().in_atomic_block)
        return PASSED


class ReverifySweepCommitTests(TransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_atomic(self.tenant.id):
            enable_feature(self.tenant, FEATURE)
            self.row = CustomDomainFactory(tenant=self.tenant, domain="www.greenfield.example")

    def test_dns_and_provisioning_run_outside_any_transaction(self) -> None:
        verifier = RecordingVerifier()
        provisioned: list[tuple[str, bool, bool]] = []

        def request(domain: str) -> None:
            # Called after the activation committed: a fresh connection state sees the route.
            routed = CustomDomainRoute.objects.filter(domain=domain).exists()
            provisioned.append((domain, transaction.get_connection().in_atomic_block, routed))

        provisioner = mock.Mock()
        provisioner.request.side_effect = request
        with (
            mock.patch(f"{SERVICES}.get_dns_verifier", return_value=verifier),
            mock.patch(f"{SERVICES}.get_edge_provisioner", return_value=provisioner),
        ):
            summary = tasks.reverify_custom_domains()
        self.assertEqual(summary["failed"], 0)
        self.assertEqual(verifier.in_transaction, [False])
        self.assertEqual(provisioned, [("www.greenfield.example", False, True)])
        with tenant_atomic(self.tenant.id):
            stored = CustomDomain.objects.get(pk=self.row.pk)
        self.assertEqual(stored.status, CustomDomainStatus.ACTIVE)
