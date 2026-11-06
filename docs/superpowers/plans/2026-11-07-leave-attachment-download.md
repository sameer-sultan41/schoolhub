# Leave Attachment Download Implementation Plan

> **For agentic workers:** implement inline (executing-plans). **Never run tests, linters or typechecks
> locally** (ADR-0007): commit, push, read CI. Regenerate `apps/api/openapi.yaml` and
> `packages/api-client/src/schema.d.ts` with the generators (L2). No AI attribution in commits or PRs.

**Work tier:** 2

**Goal:** A guardian or student can re-open the document they attached to a leave request, and every
reader of a leave request reaches its attachment only through the request's own record scope, never
through `platform.file.view`.

**Architecture:** This follows ADR-0021: a sensitive resource gets its own `:download` action. It also
applies lesson L29: no attachment field ships without its own gated download route.

- **The action:** `LeaveRequestViewSet` gets one read action,
  `POST /leave-requests/{id}/attachment:download`, returning `{data: {download_url}}`.
  - It is keyed `attendance.leave-request.view` and looks the row up through `get_queryset()`. The
    record scope therefore decides who may read it: `LeaveRequest.filter_owned_by_user` for a guardian
    or student, and `student__campus_id` or `assigned` for staff.
  - A service, `attendance.services.leave_attachment_download_url(leave_request)`, returns
    `get_download_url(file)` only for a file that is alive, `READY`, and of purpose
    `attendance.leave-attachment`. Anything else is a 404.
- **Closing the generic route:** `LEAVE_ATTACHMENT` becomes `module_gated=True`, which takes these files
  out of `GET /files` and `/files/{id}:download`, exactly as `communication.thread-attachment` already
  is. Upload is unaffected:
  - `confirm` is in `MODULE_GATED_ACTIONS_ALLOWED`;
  - `create` reads no row;
  - `assert_file_usable` reads `File` directly.
- **The response type:** the `{download_url}` serializer moves to `core/files/serializers.py`. Its
  component name stays `AttachmentDownload`, so the schema doesn't churn. Threads, oversight, leave,
  `/files/{id}:download` and `/student-documents/{id}:download` all type their 200 with it.
- **Dashboard:** the staff `LeaveAttachment` and the portal `LeaveList` both call the new route.
- **Route shape:** the deferred entries proposed `/leave-requests/{id}:download`. `/attachment:download`
  is chosen because the request is not the file, and it matches the thread route
  `message-threads/{id}/attachments/{file_id}:download`.

**Tech stack:** Django 6.1 + DRF + drf-spectacular; Next.js 16, TanStack Query, next-intl; Playwright.

**Spec:** `docs/03-modules/attendance.md` §4, §16, §20; `docs/03-modules/parent-portal.md` §5.5, §20;
ADR-0021; `docs/deferred-work.md` (the staff-side entry around line 204 and the portal entry around line 1052).

**Base:** `feat/portal-leave-vouchers` (#160). Branch `feat/portal-leave-attachment-download`; retarget to
`main` once #160 merges. #160 itself is not changed.

## Alternatives considered (why not)

| Decision | Chosen | Rejected, and why |
| -------- | ------ | ----------------- |
| How a reader reaches the file | An action on the owning resource, scoped by it, with the purpose `module_gated` (ADR-0021, L29, the thread precedent) | **Granting portal roles `platform.file.view`:** `/files` checks no ownership. **Narrowing `/files` to `created_by`:** misses a student whose guardian uploaded, and puts attendance's rule in `core/files`. **Leaving the purpose un-gated:** every staff role, a librarian included, could still sign a medical note |
| Route shape | `/leave-requests/{id}/attachment:download`, `POST` | **`/leave-requests/{id}:download`:** reads as downloading the request. **`GET`:** the thread, file and document download actions are all `POST` |
| Response type | One `AttachmentDownloadSerializer` in `core/files` | **Importing communication's from attendance:** attendance would depend on communication for a file shape. **A second copy:** a fourth route with the same shape (rule of three) |
| Staff screen | Moves to the new route | **Keeping `/files`:** it's closed by the gate; two paths to one file anyway |
| Portal download button | One shared `PortalDownloadButton` (fetch function plus labels, busy state, inline `role="alert"`) used by receipts, vouchers and leave | **A third copy:** receipts and vouchers already repeat it |
| Audit | Not audited, like every other download | — |

## Global Constraints

- **Permission key:** `required_permission_map["download_attachment"] = "attendance.leave-request.view"`,
  the viewset's read key. `DefaultRoleReadKeyTests` holds and no exemption is needed.
- **404 cases (ADR-0004):** out of scope, cross-tenant, no attachment, and a file that isn't ready, is
  deleted or has another purpose.
- **Contract:** regenerated in the same commit as the API change.
- **Copy:** `en` and `ur`. The dashboard calls the API only through `Services`.
- **Lessons:** numbering starts at **L55**, if one is needed.

## Review Focus

1. **Another family's request:** 404 (`test_other_family_request_is_404`).
2. **Campus-scoped staff outside their campus:** 404 (`test_campus_scoped_staff_outside_campus_is_404`).
3. **A pending, deleted or wrong-purpose file:** 404 (`test_unready_or_deleted_file_is_404`).
4. **A student whose guardian uploaded the file:** 200 (`test_student_downloads_attachment_their_guardian_uploaded`).
5. **A staff user holding `platform.file.view`:** `/files/{id}:download` on a leave attachment is 404,
   and the file is absent from `GET /files` (`test_leave_attachment_is_module_gated`).

---

### Task 1: Backend

**Files:**
- `core/files/serializers.py`: `AttachmentDownloadSerializer` moves here. `communication/threads/serializers.py`
  stops declaring it, and threads and oversight import it from `core.files.serializers`.
  `core/files/views.py` `download` and `student_management/views.py` `:download` type their 200 with it.
- `apps/attendance/uploads.py`: `LEAVE_ATTACHMENT` gets `module_gated=True`.
- `apps/attendance/services.py`: `leave_attachment_download_url(leave_request) -> str`.
- `apps/attendance/views.py`: `download_attachment` (`get_object_or_404(self.get_queryset(), pk=pk)`, then
  the service), the key-map entry, and `extend_schema` (`request=None`; 200 `AttachmentDownloadSerializer`;
  404 described).
- `apps/attendance/urls.py`: the path `leave-requests/<uuid:pk>/attachment:download`, named
  `leave-requests-attachment-download`.
- Test `apps/attendance/tests/test_leave_attachment_download.py`:
  - `test_guardian_downloads_attachment_for_own_child`
  - `test_student_downloads_attachment_their_guardian_uploaded`
  - `test_other_family_request_is_404`
  - `test_request_without_attachment_is_404`
  - `test_unready_or_deleted_file_is_404`
  - `test_staff_approver_downloads_without_file_view_key`
  - `test_campus_scoped_staff_outside_campus_is_404`
  - `test_other_tenant_request_is_404`
  - `test_leave_attachment_is_module_gated`
- Regenerate the contract. Commit `feat(attendance): download a leave request's attachment through its scope`.

### Task 2: Dashboard, E2E, docs

- **Services:**
  - `endpoints.ts`: `leaveRequests.attachmentDownload(id)`;
  - `leave-requests-service.ts`: `fetchLeaveAttachmentUrl(id)`, plus its service test.
- **No shared hook (amended during implementation).** With `PortalDownloadButton` holding the portal's busy
  and error state, a shared hook would wrap one service call. So each screen calls
  `Services.leaveRequests.fetchLeaveAttachmentUrl` itself, and the portal imports nothing from the staff
  `leave/` folder.
- **Staff screen:** `features/attendance/leave/leave-attachment.tsx` takes `requestId`, drops the
  `platform.file.view` gate and calls the service. Update `leave-detail-sheet.tsx`, `leave-services-mock.ts`,
  `leave-test-support.tsx` and `leave-detail.test.tsx`, and remove `attendance.leave.detail.attachment.onFile`.
- **Shared portal button:** `features/portal/portal-download-button.tsx`. Receipts and vouchers move onto
  it with unchanged behaviour, and their tests stay green.
- **Portal leave list:** each row with `attachment_file_id` gets a Download button, labelled with the
  leave type and dates so every name is unique. Remove `portal.leave.attached` and rewrite the docstring.
  Add `portal.leave.attachment.*` in `en` and `ur`.
- **E2E:**
  - **Mocked:** `attendance-approvals.spec.ts` "downloads a request's attachment" moves to the new route,
    stubbed from the contract with `ok`. `portal-leave-vouchers.spec.ts` gets a leave attachment download.
  - **Live:** `portal-leave.spec.ts`. After submitting, the guardian downloads the attachment. The test
    fetches `download_url` and asserts the body equals the uploaded bytes. Another family's guardian gets
    404 on that download.
- **Docs:**
  - `attendance.md` §16 and §20;
  - `parent-portal.md` §20;
  - `deferred-work.md`: remove both entries;
  - `project-status.md`, if it lists the deferral.
- Commit `feat(portal): re-open a leave attachment from the portal`. Push, open the PR stacked on #160,
  check CI and dispatch `e2e-live`.

## Verification

- CI is green: `api`, `frontend` and `repo-hygiene`.
- `e2e-live` on the branch passes `portal-leave.spec.ts`. The voucher PDF still fails until #151 merges.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-07
- **Verdict:** REVISE. The resource-scoped action is right, but the leave purpose must be `module_gated=True`
  (L29), or every staff role can still sign the file through `/files/{id}:download`. The review also asked
  to settle the serializer's home (`core/files`), keep the portal hook out of the staff
  `features/attendance/leave/` folder, update `attendance-approvals.spec.ts` and the leave Jest mocks, and
  make the live check fetch the signed bytes.
- **Findings addressed:**
  1. `LEAVE_ATTACHMENT` is `module_gated=True`, with `test_leave_attachment_is_module_gated`. Both deferred
     entries are removed.
  2. The serializer moves to `core/files` with its component name unchanged. The `/files` and
     `/student-documents` downloads are typed with it in the same commit.
  3. The portal imports nothing from the staff `leave/` folder (the shared hook was later dropped; see Task 2).
  4. `attendance-approvals.spec.ts` and the leave Jest mocks and tests are in Task 2.
  5. The live check asserts the signed URL serves the uploaded bytes, and keeps the other-family 404.
  6. One `PortalDownloadButton` is extracted for receipts, vouchers and leave.
  7. Download labels carry the leave type and dates.
  8. `portal.leave.attached` and the stale docstring are removed.
  9. ADR-0021 and L29 are cited, and the difference in route shape is explained.
  10. The service stays in the flat `attendance/services.py`, consistent with the module's current layout
      (ADR-0010 lists attendance as still flat).
- **Unresolved:** none. Both open questions are decided above (type both routes now; extract the button now).
