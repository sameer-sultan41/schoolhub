# 0020. A nested list carrying only a foreign id resolves it client-side, by fan-out

- **Status:** Accepted
- **Date:** 2026-10-05
- **Enforced by:** review only — `change-reviewer` agent, `schoolhub-api-services` skill checklist

## Context

The students Phase 2 relations work (`docs/superpowers/plans/2026-10-03-students-phase2-relations.md`)
needs to show each student's linked guardians by name and phone in the Guardians tab. `GET
/students/{id}/guardians` (`StudentGuardianSerializer`) returns only link fields plus
`guardian_id` — confirmed by reading `apps/api/apps/student_management/serializers.py` — never
the guardian's own name or phone. The dashboard has two ways to get there: resolve each
`guardian_id` client-side with one `GET /guardians/{id}` per row, or add a backend-embedded
guardian summary to the link serializer. Independent plan review (ADR-0015) flagged the choice
as a real architectural decision with no record, since it sets a pattern other nested-list
screens will hit the same question.

## Decision

A nested list endpoint that carries only a foreign id (no embedded summary of the thing that id
points to) is resolved client-side: fan out one request per unique id through the owning
domain's own `Services.<domain>.fetchById`-style function (never a raw `apiClient`/`endpoints`
call from the component — ADR-0011), using TanStack Query's `useQueries` with `combine` to
surface a per-row loading/error state. This is the default for a small, bounded list (a
student's handful of guardians, not a paginated collection) where N extra requests costs
noticeably less than a new backend serializer shape.

Reach instead for a backend-embedded summary (e.g. a nested serializer field, or an
`?expand=` param in the Stripe-expanding-objects style) when any of these hold:

- the list is large or paginated, so N fans out to a cost that actually matters;
- more than one screen needs the same resolved fields, so the fan-out logic would otherwise be
  duplicated across components; or
- the resolved fields are needed for filtering/sorting/search server-side, which a client-side
  fan-out cannot provide.

## Alternatives considered

- **Always embed a summary on the link/list serializer.** Why not: it is a backend change for
  every nested list that doesn't already return one, even when the list is small enough that the
  extra requests are immaterial — this would force a backend PR onto what is otherwise a
  dashboard-only change every time a new nested-id screen appears.
- **Always fan out, never embed.** Why not: for a large or genuinely paginated nested list, N
  requests per page is a real N+1 cost a backend-embedded field (or `select_related` on an
  existing serializer) avoids outright — treating fan-out as universal would paper over an actual
  performance problem on a bigger list.

## Consequences

- `StudentGuardiansTab` (students Phase 2) is the reference implementation: `useQueries` over
  `Services.guardians.fetchGuardianById`, combined to expose per-row `isPending`/`isError`/data.
- Upgrading a fan-out to an embedded summary later is a pure backend-plus-client change — the
  component only needs its data source swapped, not a rewrite — since the fan-out already goes
  through `Services` rather than reaching into `apiClient` directly.
- A future nested-list screen with more rows or more call sites than this one should re-run this
  decision's criteria rather than copy the fan-out by default.
