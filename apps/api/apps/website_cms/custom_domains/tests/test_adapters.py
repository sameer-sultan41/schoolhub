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
from apps.website_cms.models import DomainErrorCode

DOMAIN = "www.greenfield.example"
TOKEN = "token-123"
TARGET = "sites.schoolhub.example"
TXT_NAME = f"_schoolhub-verify.{DOMAIN}"


def txt(*values: str) -> list:
    return [dns.rdata.from_text("IN", "TXT", " ".join(f'"{v}"' for v in values))]


def cname(target: str) -> list:
    absolute = target if target.endswith(".") else f"{target}."
    return [dns.rdata.from_text("IN", "CNAME", absolute)]


class DnspythonVerifierTests(SimpleTestCase):
    def run_check(self, answers: dict[str, object], target: str = TARGET, *, recheck=False):
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
            verifier = DnspythonVerifier()
            check = verifier.recheck if recheck else verifier.check
            result = check(DOMAIN, TOKEN, target)
        return result, seen

    def test_token_and_cname_verify(self) -> None:
        result, seen = self.run_check({"TXT": txt(TOKEN), "CNAME": cname(f"{TARGET.upper()}.")})
        self.assertTrue(result.ok)
        self.assertEqual(
            seen,
            [(TXT_NAME, "TXT", DNS_TIMEOUT_SECONDS), (DOMAIN, "CNAME", DNS_TIMEOUT_SECONDS)],
        )

    def test_a_split_txt_string_is_joined(self) -> None:
        result, _ = self.run_check({"TXT": txt("token", "-123"), "CNAME": cname(TARGET)})
        self.assertTrue(result.ok)

    def test_definite_failures_carry_their_code(self) -> None:
        cases = [
            ({"TXT": dns.resolver.NXDOMAIN()}, DomainErrorCode.TXT_MISSING),
            ({"TXT": dns.resolver.NoAnswer()}, DomainErrorCode.TXT_MISSING),
            ({"TXT": txt("another")}, DomainErrorCode.TXT_MISMATCH),
            ({"TXT": txt(TOKEN), "CNAME": dns.resolver.NoAnswer()}, DomainErrorCode.CNAME_MISSING),
            ({"TXT": txt(TOKEN), "CNAME": cname("chain.example.")}, DomainErrorCode.CNAME_MISMATCH),
        ]
        for answers, code in cases:
            with self.subTest(code=code):
                result, _ = self.run_check(answers)
                self.assertFalse(result.ok)
                self.assertEqual(result.code, code)
                self.assertFalse(result.inconclusive)
                self.assertTrue(result.reason)

    def test_resolver_errors_are_inconclusive_not_exceptions(self) -> None:
        cases = [
            (dns.resolver.LifetimeTimeout(timeout=3.0, errors=[]), DomainErrorCode.LOOKUP_TIMEOUT),
            (dns.resolver.NoNameservers(), DomainErrorCode.LOOKUP_FAILED),
            (dns.exception.DNSException(), DomainErrorCode.LOOKUP_FAILED),
        ]
        for error, code in cases:
            for recheck in (False, True):
                with self.subTest(error=type(error).__name__, recheck=recheck):
                    result, _ = self.run_check({"TXT": error}, recheck=recheck)
                    self.assertFalse(result.ok)
                    self.assertTrue(result.inconclusive)
                    self.assertEqual(result.code, code)

    def test_an_unconfigured_resolver_is_inconclusive_not_a_500(self) -> None:
        broken = mock.patch.object(
            dns.resolver, "Resolver", side_effect=dns.resolver.NoResolverConfiguration()
        )
        with broken:
            for result in (
                DnspythonVerifier().check(DOMAIN, TOKEN, TARGET),
                DnspythonVerifier().recheck(DOMAIN, TOKEN, TARGET),
            ):
                self.assertFalse(result.ok)
                self.assertTrue(result.inconclusive)
                self.assertEqual(result.code, DomainErrorCode.LOOKUP_FAILED)

    def test_the_recheck_passes_when_the_txt_record_was_removed(self) -> None:
        # Schools may delete the TXT after go-live; the CNAME is what routes the domain.
        for missing in (dns.resolver.NXDOMAIN(), dns.resolver.NoAnswer()):
            with self.subTest(error=type(missing).__name__):
                result, _ = self.run_check({"TXT": missing, "CNAME": cname(TARGET)}, recheck=True)
                self.assertTrue(result.ok)

    def test_the_recheck_fails_on_another_token(self) -> None:
        # A new owner of the domain published their own token: a definite failure.
        answers = {"TXT": txt("new-owner"), "CNAME": cname(TARGET)}
        result, _ = self.run_check(answers, recheck=True)
        self.assertFalse(result.ok)
        self.assertFalse(result.inconclusive)
        self.assertEqual(result.code, DomainErrorCode.TXT_MISMATCH)

    def test_the_recheck_still_needs_the_cname(self) -> None:
        answers = {"TXT": dns.resolver.NXDOMAIN(), "CNAME": cname("elsewhere.example.")}
        result, _ = self.run_check(answers, recheck=True)
        self.assertFalse(result.ok)
        self.assertEqual(result.code, DomainErrorCode.CNAME_MISMATCH)

    def test_no_cname_target_fails_closed(self) -> None:
        for recheck in (False, True):
            with self.subTest(recheck=recheck):
                result, seen = self.run_check({}, target="", recheck=recheck)
                self.assertFalse(result.ok)
                # The platform's own misconfiguration never counts against a school.
                self.assertTrue(result.inconclusive)
                self.assertEqual(result.code, DomainErrorCode.TARGET_UNCONFIGURED)
                self.assertEqual(seen, [])


class FakeVerifierTests(SimpleTestCase):
    def test_only_test_domains_verify(self) -> None:
        verifier = FakeDnsVerifier()
        self.assertTrue(verifier.check("www.greenfield.test", TOKEN, "").ok)
        self.assertFalse(verifier.check("www.greenfield.example", TOKEN, "").ok)
        self.assertFalse(verifier.check("test.example", TOKEN, "").ok)
        self.assertTrue(verifier.recheck("www.greenfield.test", TOKEN, TARGET).ok)
        lapsed = verifier.recheck("www.greenfield.example", TOKEN, TARGET)
        self.assertFalse(lapsed.ok)
        self.assertFalse(lapsed.inconclusive)


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
