"""The gateway's API errors. A flag that is off reuses ``ModuleDisabled`` (403)."""

from __future__ import annotations

from typing import Literal

from rest_framework import status

from core.api.exceptions import CodedAPIException

QuotaScope = Literal["tenant", "user"]


class AIQuotaExceeded(CodedAPIException):
    """A budget is spent. ``meta.scope`` says whose: the school's month or the user's day."""

    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_detail = "The AI allowance for this period has been used up."
    default_code = "ai_quota_exceeded"

    def __init__(self, scope: QuotaScope) -> None:
        detail = (
            "Your school's monthly AI allowance has been used up."
            if scope == "tenant"
            else "Your daily AI allowance has been used up. Try again tomorrow."
        )
        super().__init__(detail, meta={"scope": scope})


class AIUnavailable(CodedAPIException):
    """AI cannot answer right now: the provider failed or is not configured, or the
    output was refused. Explicit, never silent (ai-governance.md §7.2)."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "AI is unavailable right now. Please try again later."
    default_code = "ai_unavailable"
