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

#: The fake verifier passes exactly the domains under this reserved TLD (RFC 2606).
FAKE_VERIFIED_SUFFIX = ".test"


@dataclass(frozen=True)
class DnsCheck:
    """One verification's result; `reason` is a short, user-facing sentence on failure."""

    ok: bool
    reason: str = ""


def txt_record_name(domain: str) -> str:
    """The TXT record that must hold the verification token."""
    return f"{DOMAIN_VERIFY_TXT_PREFIX}.{domain}"


class DnsVerifier(Protocol):
    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck: ...


class EdgeCertificateProvisioner(Protocol):
    def request(self, domain: str) -> None: ...


class DnspythonVerifier:
    """Real DNS: the token in the TXT record, then a CNAME from the domain to the target.

    Each query's lifetime is `DNS_TIMEOUT_SECONDS`; every resolver failure is a failed check
    with a reason, never an exception, so one bad domain cannot stop a sweep.
    """

    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        if not cname_target:
            return DnsCheck(False, "The platform's CNAME target is not configured.")
        resolver = dns.resolver.Resolver()
        resolver.timeout = DNS_TIMEOUT_SECONDS
        resolver.lifetime = DNS_TIMEOUT_SECONDS
        txt_name = txt_record_name(domain)
        try:
            values = {
                b"".join(rdata.strings).decode("utf-8", "replace")
                for rdata in resolver.resolve(txt_name, "TXT")
                if isinstance(rdata, TXT)
            }
            if token not in values:
                return DnsCheck(False, f"The TXT record at {txt_name} does not hold the token.")
            targets = {
                rdata.target.to_text(omit_final_dot=True).lower()
                for rdata in resolver.resolve(domain, "CNAME")
                if isinstance(rdata, CNAME)
            }
        except dns.resolver.NXDOMAIN, dns.resolver.NoAnswer:
            return DnsCheck(False, "A required DNS record was not found.")
        except dns.resolver.LifetimeTimeout:
            return DnsCheck(False, "The DNS lookup timed out.")
        except dns.exception.DNSException:
            return DnsCheck(False, "The DNS lookup failed.")
        if cname_target.lower().rstrip(".") not in targets:
            return DnsCheck(False, f"{domain} does not have a CNAME to {cname_target}.")
        return DnsCheck(True)


class FakeDnsVerifier:
    """Dev and tests: passes any `*.test` domain and fails the rest, the same in every process.

    Stateless on purpose, so the compose smoke test can drive it from outside the API (L64).
    """

    def check(self, domain: str, token: str, cname_target: str) -> DnsCheck:
        if domain.endswith(FAKE_VERIFIED_SUFFIX):
            return DnsCheck(True)
        return DnsCheck(False, f"The TXT record at {txt_record_name(domain)} was not found.")


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
