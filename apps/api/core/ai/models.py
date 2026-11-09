"""The AI audit trail (ai-governance.md §9, docs/05-database/entities/ai.md).

Append-only and tenant-owned, so a school's AI history is isolated by RLS and
cannot be rewritten by the application role. The rows hold references and
counts, never a prompt or an output (governance §1.6): ``input_ref`` names what
the context was built from, ``output_ref`` is a sha256 of what came back.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from core.tenancy.models import AppendOnlyTenantModel


class AIOutcome(models.TextChoices):
    #: The answer was returned to the caller.
    OK = "ok", "OK"
    #: The provider failed or is not configured; the caller got the degraded path.
    FALLBACK = "fallback", "Fallback"
    #: The provider answered, but the answer was refused (stop reason or validator).
    REFUSED = "refused", "Refused"
    #: A budget was spent; no call was made.
    QUOTA = "quota", "Quota"
    #: A kill switch or the feature's flag is off; no call was made.
    DISABLED = "disabled", "Disabled"


#: A thumbs down or a thumbs up; one list, shared by the model and the request serializer.
FEEDBACK_VALUES = [(-1, "Thumbs down"), (1, "Thumbs up")]


class AIRequest(AppendOnlyTenantModel):
    """One gateway call, whatever its outcome: exactly one row per ``run_feature``."""

    user_id = models.UUIDField()
    feature_key = models.CharField(max_length=60)
    prompt_version = models.CharField(max_length=40)
    model = models.CharField(max_length=60, blank=True, default="")
    input_ref = models.CharField(max_length=200)
    output_ref = models.CharField(max_length=200, blank=True, default="")
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    cache_creation_input_tokens = models.PositiveIntegerField(default=0)
    cache_read_input_tokens = models.PositiveIntegerField(default=0)
    latency_ms = models.PositiveIntegerField(default=0)
    outcome = models.CharField(max_length=20, choices=AIOutcome.choices)
    # Explicit rather than the base's auto_now_add: the budget windows read it, and a
    # test of a window's edge has to place a row on either side of it.
    # No index of its own: RLS puts `tenant_id` in every query, so the composite ones serve.
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_requests"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "created_at"], name="ai_requests_tenant_created_idx"),
            models.Index(
                fields=["tenant", "user_id", "created_at"], name="ai_requests_user_created_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.feature_key} {self.outcome} ({self.pk})"


class AIRequestFeedback(AppendOnlyTenantModel):
    """A thumbs up or down on one AI output, by the user who asked (ai-architecture.md §5).

    One per request. ``comment`` is stored for prompt review and never sent to a provider.
    """

    ai_request = models.OneToOneField(AIRequest, on_delete=models.PROTECT, related_name="feedback")
    user_id = models.UUIDField()
    value = models.SmallIntegerField(choices=FEEDBACK_VALUES)
    comment = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        db_table = "ai_request_feedback"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(value__in=[-1, 1]), name="ai_request_feedback_value_check"
            ),
        ]

    def __str__(self) -> str:
        return f"Feedback {self.value} on {self.ai_request_id}"
