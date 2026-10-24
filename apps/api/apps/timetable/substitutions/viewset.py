"""`TeacherSubstitutionViewSet` — request handling for `/teacher-substitutions`.

`FEATURE`, `STAFF_PERMISSIONS` and `SCAFFOLDING_VIEW_KEY` are imported from
the module root's `views.py`, shared by every viewset in every one of the
four resource packages — see that file's own docstring.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db.models import F
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

if TYPE_CHECKING:
    from rest_framework.request import Request

from apps.timetable.models import SlotStatus, TeacherSubstitution, TimetableSlot
from apps.timetable.substitutions import services
from apps.timetable.substitutions.filters import TeacherSubstitutionFilterSet
from apps.timetable.substitutions.serializers import (
    SubstituteCandidateSerializer,
    SubstituteCandidatesQuerySerializer,
    TeacherSubstitutionSerializer,
)
from apps.timetable.views import FEATURE, SCAFFOLDING_VIEW_KEY, STAFF_PERMISSIONS
from core.api.exceptions import DomainRuleViolation
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.permissions import has_permission_key, scope_queryset


class TeacherSubstitutionViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`teacher_substitutions` — dated teacher overrides (§7.2).

    No PATCH and no DELETE: §16 lists neither, and a substitution's only mutable
    state is its approval, which moves through `:approve` / `:reject` so the
    already-decided guard and the notification cannot be bypassed.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = TeacherSubstitution.objects
    serializer_class = TeacherSubstitutionSerializer
    filterset_class = TeacherSubstitutionFilterSet
    # Who is off and who covers, by name: what a vice principal searches the queue by.
    search_fields = [
        "absent_staff__first_name",
        "absent_staff__last_name",
        "substitute_staff__first_name",
        "substitute_staff__last_name",
    ]
    # The two staff columns sort on surname, which is what the client shows first and
    # the only half of a name a list is worth ordering by.
    #
    # `created_at` is the only entry with an index an ORDER BY can walk. `date` is the
    # tail of (tenant, substitute_staff, date) and (tenant, absent_staff, date), so it
    # is not a usable prefix on its own; `status` has no index; both surnames are
    # joined. Those four sort the tenant's substitutions in memory — bounded by a
    # school's cover history for one session, not by anything that grows without limit.
    ordering_fields = [
        "date",
        "status",
        "absent_staff_last_name",
        "substitute_staff_last_name",
        "created_at",
    ]
    ordering_annotations = ("absent_staff_last_name", "substitute_staff_last_name")
    # TeacherSubstitution.Meta.ordering; see RoomViewSet for why the view repeats it.
    ordering = ["-date"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    # §4 declares no substitution view key either; the same reasoning as periods
    # and rooms applies (module docstring). "own" is the substitute's own cover
    # list — the person who has to act on it.
    scope_own_field = "substitute_staff__user_id"
    scope_campus_field = "timetable_slot__section__campus_id"
    required_feature = FEATURE
    required_permission = SCAFFOLDING_VIEW_KEY
    required_permission_map = {
        "create": "timetable.substitution.create",
        "approve": "timetable.substitution.approve",
        "reject": "timetable.substitution.approve",
        "candidates": "timetable.substitution.create",
        # Two keys can cancel (an approver any open cover, a proposer their own proposal),
        # and the permission class takes one, so the route takes the view key and
        # `cancel` checks the two real keys itself before touching the row.
        "cancel": SCAFFOLDING_VIEW_KEY,
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        """The two surnames are annotated, not traversed — see `RoomViewSet` for why
        that holds even where nothing produces a ``.distinct()`` yet.

        ``scope_own_field`` here is a plain forward join (`substitute_staff__user_id`),
        so today an own-scoped substitute's queryset is not distinct; `PeriodViewSet`
        and `StudentViewSet` are where the hazard actually bites. Both staff FKs are
        non-null, so these annotations reuse the inner joins ``select_related`` already
        opens.
        """
        return (
            super()
            .get_queryset()
            .select_related(
                "timetable_slot",
                "timetable_slot__section",
                "timetable_slot__period",
                "timetable_slot__subject",
                "timetable_slot__room",
                "room",
                "absent_staff",
                "substitute_staff",
            )
            .annotate(
                absent_staff_last_name=F("absent_staff__last_name"),
                substitute_staff_last_name=F("substitute_staff__last_name"),
            )
        )

    @extend_schema(
        summary="Propose a substitution for one published slot",
        responses={
            201: TeacherSubstitutionSerializer,
            422: OpenApiResponse(
                description="§11: wrong absentee, wrong weekday, or the substitute is not free."
            ),
        },
    )
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        substitution = services.create_substitution(
            slot=data["timetable_slot"],
            on_date=data["date"],
            absent_staff=data["absent_staff"],
            substitute_staff=data["substitute_staff"],
            reason=data.get("reason"),
            room=data.get("room"),
            tenant_id=request.tenant.pk,
            actor_id=request.user.pk,
        )
        body = self.get_serializer(substitution).data
        record_audit(request, "create", substitution, after=body)
        return ActionResponse.ok(body, message="Substitution proposed.", status=201)

    @extend_schema(
        summary="Approve a proposed substitution",
        request=None,
        responses={200: TeacherSubstitutionSerializer},
    )
    def approve(self, request: Request, pk) -> Response:
        return self._decide(request, pk, approve=True, message="Substitution confirmed.")

    @extend_schema(
        summary="Reject a proposed substitution",
        request=None,
        responses={200: TeacherSubstitutionSerializer},
    )
    def reject(self, request: Request, pk) -> Response:
        return self._decide(request, pk, approve=False, message="Substitution declined.")

    @extend_schema(
        summary="Cancel open cover (an approver), or withdraw your own proposal",
        request=None,
        responses={
            200: TeacherSubstitutionSerializer,
            403: OpenApiResponse(description="Neither an approver nor this proposal's proposer."),
            409: OpenApiResponse(description="Already declined, cancelled or completed."),
            422: OpenApiResponse(description="The cover's date has passed."),
        },
    )
    def cancel(self, request: Request, pk) -> Response:
        substitution = get_object_or_404(self.get_queryset(), pk=pk)
        if has_permission_key(request.user, "timetable.substitution.approve"):
            own_proposal_only = False
        elif (
            has_permission_key(request.user, "timetable.substitution.create")
            and substitution.created_by == request.user.pk
        ):
            own_proposal_only = True
        else:
            raise PermissionDenied("Only an approver, or whoever proposed it, can cancel cover.")

        before = self.get_serializer(substitution).data
        cancelled = services.cancel_substitution(
            substitution=substitution,
            actor_id=request.user.pk,
            own_proposal_only=own_proposal_only,
        )
        after = self.get_serializer(cancelled).data
        record_audit(request, "cancel", cancelled, before=before, after=after)
        return ActionResponse.ok(after, message="Substitution cancelled.")

    @extend_schema(
        summary="The teachers free to cover a published slot on a date",
        description=(
            "Active teaching staff at the slot's campus who are not its teacher, have no "
            "class or open cover in that period, and are neither on approved leave nor "
            "marked absent that day; ordered by name. Unpaged and unfiltered."
        ),
        parameters=[SubstituteCandidatesQuerySerializer],
        responses={
            200: SubstituteCandidateSerializer(many=True),
            404: OpenApiResponse(description="No such slot within your scope."),
            422: OpenApiResponse(
                description=(
                    "The slot isn't published or has no teacher, or the date is not its "
                    "day or is outside its session."
                )
            ),
        },
    )
    def candidates(self, request: Request) -> Response:
        query = SubstituteCandidatesQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        # Under the caller's campus scope: another campus's slot is a 404, never a list
        # of its staff.
        slot = get_object_or_404(
            scope_queryset(
                TimetableSlot.objects.alive().select_related(
                    "section", "period", "academic_session", "staff"
                ),
                request.user,
                own_field="staff__user_id",
                campus_field="section__campus_id",
            ),
            pk=query.validated_data["timetable_slot_id"],
        )
        on_date = query.validated_data["date"]
        if slot.status != SlotStatus.PUBLISHED or slot.effective_to is not None:
            raise DomainRuleViolation(
                {"timetable_slot_id": "Only a live published slot can be covered."}
            )
        if slot.staff is None:
            raise DomainRuleViolation(
                {"timetable_slot_id": "This slot has no teacher, so there is no one to cover."}
            )
        if on_date.weekday() != slot.day_of_week:
            raise DomainRuleViolation({"date": "This date does not fall on the slot's weekday."})
        session = slot.academic_session
        # Create refuses such a date, so offering teachers for it would only end in a 422.
        if not (session.start_date <= on_date <= session.end_date):
            raise DomainRuleViolation({"date": "This date is outside the academic session."})

        free = services.free_substitutes(slot=slot, on_date=on_date, absent_staff=slot.staff)
        rows = free.order_by("last_name", "first_name")
        return ActionResponse.ok(SubstituteCandidateSerializer(rows, many=True).data)

    def _decide(self, request: Request, pk, *, approve: bool, message: str) -> Response:
        """Both decisions are one service call — §7.2 has no asymmetry between them."""
        substitution = get_object_or_404(self.get_queryset(), pk=pk)
        before = self.get_serializer(substitution).data

        decided = services.decide_substitution(
            substitution=substitution, approve=approve, actor_id=request.user.pk
        )
        after = self.get_serializer(decided).data
        record_audit(
            request,
            "approve" if approve else "reject",
            decided,
            before=before,
            after=after,
        )
        return ActionResponse.ok(after, message=message)
