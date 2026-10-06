# 0021. A sensitive resource gets its own permission-gated `:download` action, not just the generic `core/files` endpoint

- **Status:** Accepted
- **Date:** 2026-10-06
- **Enforced by:** review only — `change-reviewer` agent, `schoolhub-backend-module` skill checklist

## Context

The students Phase 2 relations work (`docs/superpowers/plans/2026-10-03-students-phase2-relations.md`)
adds a Documents tab that lets a user download a student's uploaded document (birth certificate,
transfer certificate, medical note). `core/files` already exposes a generic `GET /files` (list)
and `POST /files/{id}:download` (signed URL), gated only by `platform.file.view` — confirmed by
reading `apps/api/core/files/permissions.py` and `views.py` — which every staff role holds
(`ALL_STAFF`). Routing the new tab's download through that generic endpoint would mean any staff
member who can list files at all (which is nearly everyone) could fetch a signed download URL for
any student's document, regardless of whether they hold `students.document.view`. `docs/06-security/
security.md`'s SEC-17.3 requires document access to go through an explicit, resource-specific
permission key, not a platform-wide catch-all. Independent plan review (round 4) found this gap
and asked for it to be fixed or explicitly recorded; round 6 flagged that the choice itself — a
new, resource-scoped action vs. tightening the generic endpoint — is a real architectural decision
with no record, since any future document-bearing module (fee receipts, HR files, exam scripts)
will hit the identical question.

## Decision

A resource whose files need per-document authorization narrower than "any staff member" gets its
own `:download` colon-action on that resource's own viewset (here, `StudentDocumentViewSet`),
gated by that module's real permission key (`students.document.view`) through the normal
`required_permission_map` mechanism, rather than being routed through `core/files`' generic
`GET /files`/`POST /files/{id}:download`. The new action still delegates the actual signed-URL
generation to `core/files.services.get_download_url` — it duplicates authorization, not file
storage or signing logic. The resource is looked up the normal tenant-scoped way first
(`self.get_object()`), so cross-tenant access still 404s before the download ever runs.

This is the pattern to copy for a future document-bearing module: add a `:download` (or
equivalent) action on the resource's own viewset, map it to that module's view-equivalent
permission key, and call `core/files`' shared signing function from inside it. Do not grant the
resource's permission key broad access to the generic `/files` endpoints instead (e.g. by
widening `platform.file.view`'s role set) — that fixes nothing for the OTHER files already
reachable through that same broad grant.

## Alternatives considered

- **Add a purpose-aware permission check directly to `FileViewSet`'s generic list/download.**
  Why not: `core/files` has no concept of which module "owns" a given upload purpose today: it
  would need a new purpose-to-permission-key registry, and the generic endpoint would then need to
  resolve and check a different permission per file depending on its `purpose` — a real, separate
  piece of shared infrastructure touching every module that uploads files, not just students. That
  is a legitimate fix, but it is cross-cutting `core/files` work, not a single module's PR.
- **Leave the generic `/files` endpoint as the only download path and accept the exposure.**
  Why not: the Documents tab is a NEW UI surface that makes this exposure newly reachable and
  newly obvious (a user can now see a document exists and go looking for its id); shipping a tab
  whose own "download" button still routes through a too-broad permission, when a narrowly-scoped
  fix is this cheap, is worse than not building the fix at all.

## Consequences

- `StudentDocumentViewSet.download` (students Phase 2) is the reference implementation: its own
  action, its own permission-map entry, `core/files.services.get_download_url` called from inside
  it rather than reimplemented.
- The generic `/files` endpoints remain reachable by any `platform.file.view` holder for every
  purpose, including student documents — this ADR does not close that path, only adds a narrower
  one alongside it. `docs/deferred-work.md` records the generic endpoint's own exposure as a
  pre-existing, platform-wide gap, separate from this decision.
- A future document-bearing module (fee receipts, HR personnel files, exam scripts) should default
  to this same resource-scoped-action pattern rather than re-litigating the choice, unless its own
  circumstances differ enough to warrant revisiting Alternative 1 above as a real, separate
  `core/files` enhancement.
