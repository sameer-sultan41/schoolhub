"""`GET /ai/usage` and `POST /ai/requests/{id}:feedback`.

Feature endpoints live in their owning module (ADR-0035): core cannot import the
code that builds a feature's context (ADR-0013). These two are the gateway's own.
Neither is gated by `ai.gateway`: a school that switched AI off can still see what
it used and rate what it was shown.
"""

from __future__ import annotations

import uuid

from django.db.models import Count, Sum
from django.db.models.functions import Coalesce
from django.http import Http404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.ai import budget
from core.ai.models import AIRequest, AIRequestFeedback
from core.ai.serializers import (
    AIFeedbackRequestSerializer,
    AIFeedbackSerializer,
    AIUsageSerializer,
)
from core.api.exceptions import Conflict
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.rbac.permissions import HasPermissionKey


class AIUsageView(TenantScopedViewSetMixin, APIView):
    """This month's token use against the budget, by feature (ai-governance.md §9).

    The mixin is here for its tenant binding only (as on `SchoolSettingsView`); RLS
    keeps the sums to the caller's school.
    """

    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    required_permission = "ai.usage.view"
    # AI usage is school-wide: there is no campus dimension to narrow by.
    scope_campus_field = None

    @extend_schema(summary="AI token usage this month", responses={200: AIUsageSerializer})
    def get(self, request: Request) -> Response:
        tenant = request.tenant
        since = budget.month_start(tenant)
        rows = (
            AIRequest.objects.filter(created_at__gte=since)
            .values("feature_key")
            .annotate(tokens=Coalesce(Sum(budget.TOTAL_TOKENS), 0), requests=Count("id"))
            .order_by("feature_key")
        )
        by_feature = [
            {
                "feature_key": row["feature_key"],
                "tokens": row["tokens"],
                "requests": row["requests"],
            }
            for row in rows
        ]
        payload = {
            "month_tokens": sum(row["tokens"] for row in by_feature),
            "monthly_limit": budget.monthly_limit(tenant),
            "by_feature": by_feature,
        }
        return ActionResponse.ok(AIUsageSerializer(payload).data)


class AIRequestFeedbackView(TenantScopedViewSetMixin, APIView):
    """Thumbs up or down on one AI output, once, by the user it was shown to.

    Another user's request is a 404, as is another school's (RLS hides it): the
    caller learns nothing about a request that is not theirs. A second vote is a
    409; a racing second vote hits the unique constraint, which the error handler
    turns into the same `conflict`.
    """

    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    required_permission = "ai.feedback.create"
    # A request belongs to the user who made it, not a campus; ownership is checked below.
    scope_campus_field = None

    @extend_schema(
        summary="Rate an AI output",
        request=AIFeedbackRequestSerializer,
        responses={201: AIFeedbackSerializer},
    )
    def post(self, request: Request, pk: uuid.UUID) -> Response:
        serializer = AIFeedbackRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        ai_request = AIRequest.objects.filter(pk=pk, user_id=request.user.pk).first()
        if ai_request is None:
            raise Http404
        if AIRequestFeedback.objects.filter(ai_request=ai_request).exists():
            raise Conflict("You have already rated this AI output.")

        feedback = AIRequestFeedback.objects.create(
            tenant=request.tenant,
            ai_request=ai_request,
            user_id=request.user.pk,
            created_by=request.user.pk,
            value=serializer.validated_data["value"],
            comment=serializer.validated_data["comment"],
        )
        return ActionResponse.ok(
            AIFeedbackSerializer(feedback).data,
            message="Thanks for the feedback.",
            status=status.HTTP_201_CREATED,
        )
