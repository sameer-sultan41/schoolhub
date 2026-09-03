"""Idempotency-key storage (api-architecture.md §2.5).

Mutating colon-actions that support `Idempotency-Key` (module doc §16:
`:enroll`, `:change-section`, `:withdraw`, and the transfer decision actions)
store their response here for 24h and replay it verbatim on a repeat key
instead of re-running the action. See `services.replay_or_execute` for the
replay/store logic and its documented limitation against a true concurrent
double-submit.
"""

from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from core.tenancy.models import TenantOwnedModel


class IdempotencyRecord(TenantOwnedModel):
    key = models.CharField(max_length=255, help_text="The client's Idempotency-Key header value.")
    endpoint = models.CharField(
        max_length=100, help_text="Caller-chosen identifier, e.g. 'students:enroll'."
    )
    response_status = models.PositiveSmallIntegerField()
    # encoder=DjangoJSONEncoder is load-bearing, not decorative: a stored
    # response's `data` still carries native uuid.UUID/date objects at this
    # point (DRF only stringifies them when a response is rendered) — see
    # core.audit.services._json_safe's docstring for the exact TypeError this
    # avoids.
    response_body = models.JSONField(encoder=DjangoJSONEncoder)

    class Meta:
        db_table = "idempotency_records"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "key", "endpoint"],
                name="idempotency_records_unique_key_per_endpoint",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            # Supports a future cleanup job pruning rows past the 24h window
            # (no Celery beat exists yet — PR4 territory).
            models.Index(fields=["tenant", "created_at"], name="idempot_records_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.endpoint}:{self.key}"
