"""The caller's IP address, behind however many proxies the deployment has (`NUM_PROXIES`)."""

from __future__ import annotations

import ipaddress

from django.http import HttpRequest
from rest_framework.request import Request
from rest_framework.settings import api_settings


def client_ip(request: HttpRequest | Request) -> str | None:
    """The caller's IP address, trusting `X-Forwarded-For` only as far as `NUM_PROXIES` says.

    With `NUM_PROXIES` unset (`None`) or 0 the header is ignored, since anyone can send it;
    with N, the address the outermost of our N proxies saw is used, as DRF's throttles do.
    Returns `None` when there is no valid address (never a raw header value).
    """
    remote = request.META.get("REMOTE_ADDR")
    num_proxies = api_settings.NUM_PROXIES
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    candidate = remote
    if num_proxies and forwarded:
        addresses = [address.strip() for address in forwarded.split(",")]
        candidate = addresses[-min(num_proxies, len(addresses))]
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None
