"""DNS verification and TLS provisioning adapters for custom domains (plan decision 7).

Selected by setting, as ADR-0034 selects a payment provider: `WEBSITE_DNS_VERIFIER` names the
verifier (`dnspython`, or `fake` in dev and tests), `WEBSITE_EDGE_PROVISIONER` the TLS
provisioner (`null` is the only one in v1). Both may do network I/O, so callers never hold a
transaction or a lock across them.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import dns.exception
import dns.resolver
from django.conf import settings
from dns.rdtypes.ANY.CNAME import CNAME
from dns.rdtypes.ANY.TXT import TXT

from apps.website_cms.constants import DNS_TIMEOUT_SECONDS, DOMAIN_VERIFY_TXT_PREFIX
from apps.website_cms.models import DomainErrorCode

#: The fake verifier passes exactly the domains under this reserved TLD (RFC 2606).
FAKE_VERIFIED_SUFFIX = ".test"


@dataclass(frozen=True)
class DnsCheck:
    """One check's result. On failure, `reason` is a short sentence and `code` its enum value.

    `inconclusive` marks a failure of the lookup itself (a timeout, no answering resolver, no
    resolver configuration, the platform's own target unset): it says nothing about the
    school's records, so the daily re-check never counts it towards lapsing a domain.
    """

    ok: bool
    reason: str = ""
    code: str = ""
    inconclusive: bool = False


PASSED = DnsCheck(True)


def failed(code: DomainErrorCode, reason: str) -> DnsCheck:
    """A definite failure: the school's records say no."""
    return DnsCheck(False, reason, code)


def inconclusive(code: DomainErrorCode, reason: str) -> DnsCheck:
    """The lookup could not answer; the records are unknown."""
    return DnsCheck(False, reason, code, inconclusive=True)


def txt_record_name(domain: str) -> str:
    """The TXT record that must hold the verification token."""
    return f"{DOMAIN_VERIFY_TXT_PREFIX}.{domain}"


class DnsVerifier(Protocol):
    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        """Claim and `:verify`: the TXT record must hold the token, and the CNAME must match."""
        ...

    def recheck(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        """The daily re-check: the CNAME must match, and a TXT record, if any, must hold the
        token. A missing TXT passes (schools may delete it); another token fails, so a new
        owner of the domain evicts a stale holder."""
        ...


class EdgeCertificateProvisioner(Protocol):
    def request(self, domain: str) -> None: ...


class DnspythonVerifier:
    """Real DNS: the TXT record, then a direct CNAME from the domain to the target.

    Each query's lifetime is `DNS_TIMEOUT_SECONDS`. Every resolver failure, building the
    resolver included, is a failed check (inconclusive), never an exception, so one bad
    domain cannot stop a sweep. CNAME chains are not followed.
    """

    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        return self._run(domain, token, cname_target, txt_required=True)

    def recheck(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        return self._run(domain, token, cname_target, txt_required=False)

    def _run(self, domain: str, token: str, cname_target: str, *, txt_required: bool) -> DnsCheck:
        if not cname_target:
            return inconclusive(
                DomainErrorCode.TARGET_UNCONFIGURED,
                "The platform's CNAME target is not configured.",
            )
        txt_name = txt_record_name(domain)
        try:
            # Reads the host's resolver configuration, which can itself fail.
            resolver = dns.resolver.Resolver()
            resolver.timeout = DNS_TIMEOUT_SECONDS
            resolver.lifetime = DNS_TIMEOUT_SECONDS
            values = _txt_values(resolver, txt_name)
            if values is None and txt_required:
                return failed(DomainErrorCode.TXT_MISSING, f"No TXT record at {txt_name}.")
            if values is not None and token not in values:
                return failed(
                    DomainErrorCode.TXT_MISMATCH,
                    f"The TXT record at {txt_name} does not hold this domain's token.",
                )
            targets = _cname_targets(resolver, domain)
        except dns.resolver.LifetimeTimeout:
            return inconclusive(DomainErrorCode.LOOKUP_TIMEOUT, "The DNS lookup timed out.")
        except dns.exception.DNSException:
            return inconclusive(DomainErrorCode.LOOKUP_FAILED, "The DNS lookup failed.")
        if targets is None:
            return failed(DomainErrorCode.CNAME_MISSING, f"{domain} has no CNAME record.")
        if cname_target.lower().rstrip(".") not in targets:
            return failed(
                DomainErrorCode.CNAME_MISMATCH,
                f"{domain} does not have a direct CNAME to {cname_target}.",
            )
        return PASSED


def _txt_values(resolver: dns.resolver.Resolver, name: str) -> set[str] | None:
    """The TXT strings at `name` (each record's parts joined), or None when there is none."""
    try:
        answer = resolver.resolve(name, "TXT")
    except dns.resolver.NXDOMAIN, dns.resolver.NoAnswer:
        return None
    return {
        b"".join(rdata.strings).decode("utf-8", "replace")
        for rdata in answer
        if isinstance(rdata, TXT)
    }


def _cname_targets(resolver: dns.resolver.Resolver, domain: str) -> set[str] | None:
    """The lowercased direct CNAME targets of `domain`, or None when it has no CNAME."""
    try:
        answer = resolver.resolve(domain, "CNAME")
    except dns.resolver.NXDOMAIN, dns.resolver.NoAnswer:
        return None
    return {
        rdata.target.to_text(omit_final_dot=True).lower()
        for rdata in answer
        if isinstance(rdata, CNAME)
    }


class FakeDnsVerifier:
    """Dev and tests: passes any `*.test` domain and fails the rest, the same in every process.

    Stateless on purpose, so the compose smoke test can drive it from outside the API (L64).
    """

    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        if domain.endswith(FAKE_VERIFIED_SUFFIX):
            return PASSED
        return failed(DomainErrorCode.TXT_MISSING, f"No TXT record at {txt_record_name(domain)}.")

    def recheck(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        if domain.endswith(FAKE_VERIFIED_SUFFIX):
            return PASSED
        return failed(
            DomainErrorCode.CNAME_MISMATCH,
            f"{domain} does not have a direct CNAME to {cname_target}.",
        )


class NullProvisioner:
    """v1 has no edge provider, so `tls_status` stays `pending` (deferred-work.md)."""

    def request(self, domain: str) -> None:
        return None


_VERIFIERS: dict[str, Callable[[], DnsVerifier]] = {
    "dnspython": DnspythonVerifier,
    "fake": FakeDnsVerifier,
}
_PROVISIONERS: dict[str, Callable[[], EdgeCertificateProvisioner]] = {"null": NullProvisioner}


def get_dns_verifier() -> DnsVerifier:
    name = settings.WEBSITE_DNS_VERIFIER
    if name not in _VERIFIERS:
        raise ValueError(f"Unknown WEBSITE_DNS_VERIFIER {name!r}")
    return _VERIFIERS[name]()


def get_edge_provisioner() -> EdgeCertificateProvisioner:
    name = settings.WEBSITE_EDGE_PROVISIONER
    if name not in _PROVISIONERS:
        raise ValueError(f"Unknown WEBSITE_EDGE_PROVISIONER {name!r}")
    return _PROVISIONERS[name]()
