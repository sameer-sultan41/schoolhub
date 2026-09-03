"""Pins the wire contract the TypeScript client is generated against.

These exist because the contract silently diverged once already: the backend
returned `next`/`previous` holding absolute URLs while the client read
`next_cursor`/`previous_cursor` expecting bare tokens. Nothing failed — pagination
simply stopped after the first page, in every list in the product.

Serializer-level tests cannot catch that; only the rendered envelope can.
"""

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    grant,
)
from core.api.exceptions import _CODE_BY_STATUS
from core.tenancy.context import tenant_context

# Kept in step with packages/types/src/api.ts by the assertion below.
CLIENT_KNOWN_SERVER_CODES = {
    "validation_error",
    "unauthenticated",
    "permission_denied",
    "not_found",
    "method_not_allowed",
    "conflict",
    "unprocessable",
    "domain_rule_violation",
    "rate_limited",
    "module_disabled",
}


class PaginationEnvelopeTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")
        grant(self.user, "school.campus.view")
        with tenant_context(self.tenant.id):
            for _ in range(3):
                CampusFactory(tenant=self.tenant)

    def test_cursor_page_exposes_the_documented_keys(self):
        response = self.client.get("/api/v1/campuses?page_size=2")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pagination = response.json()["meta"]["pagination"]
        self.assertEqual(set(pagination), {"next_cursor", "previous_cursor", "page_size"})

    def test_next_cursor_is_a_token_the_client_can_send_back(self):
        """A URL here would be unusable: the contract is `?cursor=<token>`."""
        first = self.client.get("/api/v1/campuses?page_size=2").json()
        token = first["meta"]["pagination"]["next_cursor"]

        self.assertIsNotNone(token, "three campuses at page_size=2 must paginate")
        self.assertNotIn("://", token, "the cursor must be a token, not a URL")

        second = self.client.get(f"/api/v1/campuses?page_size=2&cursor={token}")

        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(len(second.json()["data"]), 1)
        first_ids = {row["id"] for row in first["data"]}
        second_ids = {row["id"] for row in second.json()["data"]}
        self.assertEqual(first_ids & second_ids, set(), "pages must not overlap")


class ErrorCodeContractTests(APITestCase):
    def test_the_client_knows_every_code_the_server_can_emit(self):
        from core.api.exceptions import Conflict, DomainRuleViolation, ModuleDisabled

        emitted = set(_CODE_BY_STATUS.values()) | {
            DomainRuleViolation.default_code,
            Conflict.default_code,
            ModuleDisabled.default_code,
        }
        self.assertEqual(
            emitted - CLIENT_KNOWN_SERVER_CODES,
            set(),
            "codes the server emits that packages/types/src/api.ts does not list",
        )
        self.assertEqual(
            CLIENT_KNOWN_SERVER_CODES - emitted,
            set(),
            "codes the client expects that the server never emits",
        )
