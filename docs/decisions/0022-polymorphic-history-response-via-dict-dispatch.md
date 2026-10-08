# 0022. Document a polymorphic list response with `PolymorphicProxySerializer` for the schema, dispatch it at runtime with a plain dict lookup

- **Status:** Accepted
- **Date:** 2026-10-07
- **Enforced by:** review only — `change-reviewer` agent, `schoolhub-backend-module` skill checklist

## Context

Phase 3 (`docs/superpowers/plans/2026-10-07-students-phase3-enrollment.md`) documents
`GET /students/{id}/history`'s response shape for the first time — it previously had no OpenAPI
response schema at all (`@extend_schema` carried only a description). The endpoint returns a plain
list of events, and the events are not all the same shape: `build_history` (`apps/api/apps/
student_management/services.py`) emits a mix of enrollment events and transfer events, discriminated
by a `type` field, with no common parent shape beyond `type`/`id`/`date`/`status`. This is this
codebase's first response of this kind — every other documented endpoint returns one single
serializer's shape, list or not.

Two things had to be gotten right, and the first review round of this phase's plan found the first
draft had neither: `PolymorphicProxySerializer` (drf-spectacular) looks like a serializer but has no
real `to_representation` — confirmed against the installed drf-spectacular source — so it cannot
actually serialize anything at runtime; and reusing `EnrollmentStatus`/`TransferStatus`'s existing
choice sets in two new serializer components triggers drf-spectacular's enum-collision detection,
which fails this repo's `--fail-on-warn` schema generation step without an explicit
`ENUM_NAME_OVERRIDES` entry.

## Decision

A polymorphic, discriminated-by-field list response is documented and served as two separate
pieces:

- **Runtime:** a plain `dict[str, type[Serializer]]` keyed by the discriminator value
  (`{"enrollment": EnrollmentHistoryEventSerializer, "transfer": TransferHistoryEventSerializer}`),
  looked up per item and used to serialize each one explicitly in the view. No DRF/drf-spectacular
  construct serializes a polymorphic list on its own; this dispatch is hand-written, once, at module
  level next to the view.
- **Documentation:** `@extend_schema(responses=PolymorphicProxySerializer(component_name=...,
  serializers={...}, resource_type_field_name="type", many=True))` — used purely for the generated
  OpenAPI schema (a `oneOf` with a `discriminator`), never for actual serialization.
  `many=True` is required whenever the real response is a list, not a single event.
- **Enum collisions:** whenever a polymorphic branch's serializer reuses an existing model's choice
  set (rather than declaring a new one), add the resulting generated component name(s) to
  `SPECTACULAR_SETTINGS["ENUM_NAME_OVERRIDES"]` in the same commit, pinned to the real model choice
  class. Generate the schema and read the actual warning/generated name before guessing at the
  override key — drf-spectacular's hash-suffixed fallback name is not predictable from the model
  name alone.

This is the pattern to copy for a future "list of mixed event types" endpoint: never assume
`PolymorphicProxySerializer` does any runtime work, and always check for an enum-collision warning
the moment a polymorphic branch's serializer reuses an existing choice set.

## Alternatives considered

- **One combined serializer with every field from every branch, all nullable.** Why not: it
  documents a field as possibly present on an event type that can never actually have it (e.g.
  `external_school_name` on an enrollment event), which is a worse, less precise contract than the
  real `oneOf`/discriminator shape — and `build_history`'s own dict construction already keeps the
  two shapes cleanly separate, so flattening them back together at the serializer layer would be
  pure loss.
- **A hand-written OpenAPI schema override bypassing drf-spectacular's own extension points.**
  Why not: ADR-0005 treats the generated contract as the single source of truth specifically to
  rule out a hand-maintained schema drifting from the real response; a hand-written override for
  just this one endpoint reopens exactly the drift risk that ADR exists to close.

## Consequences

- `EnrollmentHistoryEventSerializer`/`TransferHistoryEventSerializer` (`apps/api/apps/
  student_management/serializers.py`) and the dict-dispatch in `StudentViewSet.history`
  (`apps/api/apps/student_management/views.py`) are the reference implementation.
- A future polymorphic list endpoint should default to this same runtime-dict/documentation-proxy
  split rather than re-discovering that `PolymorphicProxySerializer` has no `to_representation`.
- Any such endpoint reusing an existing model's choice set in a new serializer component must add
  the matching `ENUM_NAME_OVERRIDES` entry in the same commit, or CI's `--fail-on-warn` schema
  generation step fails.
