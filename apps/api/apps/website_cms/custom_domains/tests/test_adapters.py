"""The DNS verifiers and adapter selection (plan decision 7)."""

from __future__ import annotations

from unittest import mock

import dns.exception
import dns.rdata
import dns.resolver
from django.test import SimpleTestCase, override_settings

from apps.website_cms.constants import DNS_TIMEOUT_SECONDS
from apps.website_cms.custom_domains.adapters import (
    DnspythonVerifier,
    FakeDnsVerifier,
    NullProvisioner,
    get_dns_verifier,
    get_edge_provisioner,
)

DOMAIN = "www.greenfield.example"
TOKEN = "token-123"
TARGET = "sites.schoolhub.example"


def txt(*values: str) -> list:
    return [dns.rdata.from_text("IN", "TXT", " ".join(f'"{v}"' for v in values))]


def cname(target: str) -> list:
    absolute = target if target.endswith(".") else f"{target}."
    return [dns.rdata.from_text("IN", "CNAME", absolute)]


class DnspythonVerifierTests(SimpleTestCase):
    def run_check(self, answers: dict[str, object], target: str = TARGET):
        """`answers` maps a record type to its rdata list or an exception to raise."""
        seen: list[tuple[str, str, float]] = []

        def resolve(resolver, qname, rdtype, *args, **kwargs):
            seen.append((qname, rdtype, resolver.lifetime))
            answer = answers[rdtype]
            if isinstance(answer, Exception):
                raise answer
            return answer

        with mock.patch.object(dns.resolver.Resolver, "resolve", autospec=True) as patched:
            patched.side_effect = resolve
            result = DnspythonVerifier().check(DOMAIN, TOKEN, target)
        return result, seen

    def test_token_and_cname_verify(self) -> None:
        result, seen = self.run_check({"TXT": txt(TOKEN), "CNAME": cname(f"{TARGET.upper()}.")})
        self.assertTrue(result.ok)
        self.assertEqual(
            seen,
            [
                (f"_schoolhub-verify.{DOMAIN}", "TXT", DNS_TIMEOUT_SECONDS),
                (DOMAIN, "CNAME", DNS_TIMEOUT_SECONDS),
            ],
        )

    def test_a_split_txt_string_is_joined(self) -> None:
        result, _ = self.run_check({"TXT": txt("token", "-123"), "CNAME": cname(TARGET)})
        self.assertTrue(result.ok)

    def test_wrong_token_fails(self) -> None:
        result, seen = self.run_check({"TXT": txt("another"), "CNAME": cname(TARGET)})
        self.assertFalse(result.ok)
        self.assertIn("does not hold the token", result.reason)
        self.assertEqual(len(seen), 1)

    def test_wrong_cname_fails(self) -> None:
        result, _ = self.run_check({"TXT": txt(TOKEN), "CNAME": cname("elsewhere.example.")})
        self.assertFalse(result.ok)
        self.assertIn("CNAME", result.reason)

    def test_resolver_errors_are_failed_checks_not_exceptions(self) -> None:
        for error, words in (
            (dns.resolver.NXDOMAIN(), "not found"),
            (dns.resolver.NoAnswer(), "not found"),
            (dns.resolver.LifetimeTimeout(timeout=DNS_TIMEOUT_SECONDS, errors=[]), "timed out"),
            (dns.resolver.NoNameservers(), "failed"),
            (dns.exception.DNSException(), "failed"),
        ):
            with self.subTest(error=type(error).__name__):
                result, _ = self.run_check({"TXT": error})
                self.assertFalse(result.ok)
                self.assertIn(words, result.reason)

    def test_no_cname_target_fails_closed(self) -> None:
        result, seen = self.run_check({}, target="")
        self.assertFalse(result.ok)
        self.assertEqual(seen, [])


class FakeVerifierTests(SimpleTestCase):
    def test_only_test_domains_verify(self) -> None:
        verifier = FakeDnsVerifier()
        self.assertTrue(verifier.check("www.greenfield.test", TOKEN, "").ok)
        self.assertFalse(verifier.check("www.greenfield.example", TOKEN, "").ok)
        self.assertFalse(verifier.check("test.example", TOKEN, "").ok)


class AdapterSelectionTests(SimpleTestCase):
    def test_settings_choose_the_adapters(self) -> None:
        with override_settings(WEBSITE_DNS_VERIFIER="dnspython"):
            self.assertIsInstance(get_dns_verifier(), DnspythonVerifier)
        with override_settings(WEBSITE_DNS_VERIFIER="fake"):
            self.assertIsInstance(get_dns_verifier(), FakeDnsVerifier)
        self.assertIsInstance(get_edge_provisioner(), NullProvisioner)

    def test_an_unknown_name_is_a_configuration_error(self) -> None:
        with override_settings(WEBSITE_DNS_VERIFIER="nope"), self.assertRaises(ValueError):
            get_dns_verifier()
        with override_settings(WEBSITE_EDGE_PROVISIONER="nope"), self.assertRaises(ValueError):
            get_edge_provisioner()
