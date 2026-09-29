# Staff Bulk Export/Import (CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Work tier:** 2

**Goal:** Wire the `/staff` toolbar's two bulk-data buttons to the real, already-shipped
backend — `POST /staff-exports` (download the whole staff list as CSV) and
`POST /staff-imports` (bulk-create staff from an uploaded CSV/.xlsx) — including the
job-polling UI both need, since neither endpoint responds synchronously.

**Architecture:** Both endpoints return `202 {job_id}` immediately; the real work runs in a
Celery task and is tracked on a `core.jobs.BackgroundJob` row the client polls via
`GET /jobs/{id}` until it reaches `succeeded`/`failed`. This plan adds one small, reusable
platform-level piece (`Services.jobs` + a `useJobPolling` hook) that both features share,
a new `Services.staff` module for the two trigger calls (per ADR-0011), a permission
helper so the buttons only render live for roles actually granted `staff.staff.export`/
`.import`, a real "Export CSV" button, and a real "Import CSV" dialog — ported from this
app's own earlier `features/staff/import-wizard.tsx` (deleted in an unrelated shell-reset
commit, not because it was wrong).

**Tech Stack:** Next.js 16 dashboard, TanStack Query v5 (`refetchInterval` + `skipToken`
for polling), `next-intl`, `@schoolhub/ui` (`Dialog`, `Progress`, `Alert`, `Table`,
`Badge`, `Label`, `Button`, `Input`), `sonner` toasts, Jest + React Testing Library,
Playwright (mocked `dashboard` project).

**Spec:** None as a separate document. All three backend endpoints this plan wires up
already exist, are already implemented and already generated into
`apps/api/openapi.yaml`/`packages/api-client/src/schema.d.ts` — confirmed by reading
`apps/api/apps/staff_management/staff/viewset.py` (`StaffExportViewSet`,
`StaffImportViewSet`), `apps/api/apps/staff_management/tasks.py`,
`apps/api/apps/staff_management/staff/services/{export_staff,import_staff}.py`,
`apps/api/apps/staff_management/permissions.py`, `apps/api/core/jobs/{models,
serializers,views}.py` and `apps/api/core/files/views.py` directly, not assumed. This
plan's Global Constraints and Alternatives Considered sections carry the design
decisions a separate spec doc would otherwise hold.

**Revision note:** this plan went through two rounds of independent review
(`plan-reviewer`, both 2026-09-27), both REVISE. Round 1 found the polling hook's
timeout was fundamentally broken (never reached a re-render) and reused nothing from
this app's own deleted precedent; round 2, after that rewrite, found a *second*,
narrower timeout bug (a timed-out job that had actually already succeeded), several
concrete CI-failure-causing issues (a `tsc` error, a frozen lint baseline, three broken
Jest assertions, e2e tests that would hang against the real default permission set, and
literal `Run: npx jest ...` steps that contradict this repo's own "never run tests
locally" rule with no TDD carve-out), and a handful of Medium/Low polish items. Every
Critical/High finding from both rounds is fixed in the tasks below; the remaining
Medium/Low items are recorded as explicit, reasoned Rulings rather than looped through
a third automated review — see each task's own "why this changed" note and the
"Rulings" section after Alternatives Considered.

## Global Constraints

- **No backend changes.** `POST /staff-exports`, `POST /staff-imports`,
  `GET /jobs/{id}`, `POST /files/{id}:download` are all real, already-registered routes
  with `required_permission`s already set (`staff.staff.export`, `staff.staff.import`,
  `platform.job.view`) and already present in `apps/api/openapi.yaml`. Do not touch
  `apps/api/` and do not run the OpenAPI/schema regeneration scripts in
  `.claude/rules/api-contract.md` — there is no contract diff to regenerate. One real
  gap this surfaces (the download URL carries no `Content-Disposition`, so the browser
  names the file after its storage key, not `staff-export.csv`) is deliberately
  deferred — see Alternatives Considered and Task 5's docs step.
- **Permission-aware UI, for real this time.** `staff.staff.export`/`.import` are
  granted only to `STAFF_IO` (`hr_staff`, `it_admin`) — narrower than `RECORD_MANAGERS`
  (`hr_staff`, `school_admin`), who already see every *other* action on this screen.
  Rendering these two buttons unconditionally would give a `school_admin` two buttons
  that always 403. Task 3 adds a `hasPermission` helper (the per-action gate
  `apps/dashboard/AGENTS.md`'s wiring table already names as the thing to add "when the
  first screen needs it" — this is that screen) and Task 5 wires it in.
- **`Services.<domain>.<action>(...)` only** (`apps/dashboard/AGENTS.md`) — no component
  imports `@schoolhub/api-client` or calls `apiClient` directly; every path lives in
  `src/services/endpoints.ts`. New staff calls go in a new `services/modules/staff/`
  module, per ADR-0011's own text ("staff calls belong in `services/modules/staff/`,
  not in `Services.dashboard`") — the *existing* staff calls already in
  `Services.dashboard` (`fetchStaffPage`, `createStaff`, etc.) are that ADR's own
  documented, tracked drift; moving them is a separate migration, out of scope here.
- **i18n: dialog yes, toolbar labels no — deliberately inconsistent, explained.** The
  new `StaffImportDialog` uses `useTranslations("staff")`/`("errors")`/`("common")`
  throughout, because it is a port of this app's own previously-shipped
  `features/staff/import-wizard.tsx`, which did the same, and because the exact message
  keys it needs (`staff.import.*`) already exist, unused, in both `messages/en.json`
  and `messages/ur.json` — skipping them would re-orphan content someone already wrote
  and had reviewed. The toolbar's own two button *labels* ("Export CSV", "Import CSV",
  "Exporting…") stay hardcoded English, matching every other string in
  `staff-toolbar.tsx` today ("Add Member", "All Members", "Teaching Staff" are all
  hardcoded, untranslated, and already merged) — translating only two of that file's
  many strings would be a worse inconsistency than leaving all of them as they are.
  Hard Rule 4 (map a known `ApiError.code` through `errors.*`, never invent a message)
  is **not** optional either way and is followed in both places.
- **85% global coverage floor** (`apps/dashboard/jest.config.ts` `coverageThreshold`) —
  every new file needs real tests covering its branches, not just the happy path.
- **Never run tests/lint/typecheck locally, including as a TDD red/green check** —
  commit, push, read `gh pr checks <n> --watch` (root `AGENTS.md`; the user's own global
  instructions repeat this with no TDD carve-out). Every task below writes its test(s)
  first, then its implementation, then commits — a "Note:" line under each test names
  what CI's `Test (coverage)` job should report once both are pushed, in place of a
  literal `Run: npx jest ...` instruction. Do not run `pnpm test`/`jest`/`tsc`/`eslint`
  as a step of implementing this plan; that includes not running Playwright locally for
  Task 5's e2e additions either.
- **Docs update in the same PR** — `docs/project-status.md` and `docs/deferred-work.md`
  (repo-hygiene's doc-sync gate). Handled as the last step of Task 5.

## Alternatives Considered (why not)

- **A hand-rolled polling loop inside the trigger `mutationFn`** (kick off the job, then
  `await` a `while` loop with its own `setTimeout`s and an `AbortSignal`) instead of a
  separate `useQuery`-based hook — rejected: it would re-implement cache sharing,
  automatic cleanup on unmount, and DevTools visibility that `refetchInterval` already
  gives for free, and it would hide the in-flight job from React Query's own cache (two
  components polling the same job — unlikely here, but the pattern is meant to be
  reused — would each run their own loop instead of sharing one).
- **A dedicated `/staff/import` route/wizard page** instead of a dialog — rejected: the
  import is one short-lived action off the staff list, not a multi-step wizard, and
  this screen's own precedent (Add/Edit staff, Exit staff) is already dialog-based;  a
  full page would add routing for no benefit.
- **A toast for the import's row-level failures**, matching the export's toast-only
  treatment — rejected for import specifically: a multi-row error list needs to stay
  visible and scannable while the user reads it, which is exactly why
  `exit-staff-dialog.tsx` already shows its own partial-failure list inline (an `Alert`
  plus a list) rather than in a toast that disappears in a few seconds. The export has
  no comparable list to show, so a toast is the right (and simpler) choice there.
- **Ship the buttons live and rely on the server's 403** instead of a permission gate —
  rejected: Hard Rule 1 (`apps/dashboard/AGENTS.md`) requires hiding or disabling by
  permission key, and this is a concrete, not hypothetical, case of it — `school_admin`
  is `apps/dashboard`'s own default e2e test user's role (`e2e/src/data/factories.ts`'s
  `buildUser()`), and it does not hold `staff.staff.export`/`.import`.
- **Add `ResponseContentDisposition` to `core/files/storage.py`'s presigner now**, so
  the downloaded file is actually named `staff-export.csv` — rejected for *this* plan:
  it is a backend change to shared platform infra (every module's file downloads, not
  staff-specific) outside the stated "no backend changes" scope, and the file still
  downloads and opens correctly without it (some browsers just name it after the
  storage key instead). Deferred to `docs/deferred-work.md` in Task 5, not silently
  dropped.

## Rulings (from the second independent review round)

The second `plan-reviewer` pass raised several additional Medium/Low findings beyond
the Critical/High ones already folded into the tasks above. These were decided rather
than looped through a third review round — each is a real, considered trade-off, not
an oversight:

- **`hasPermission` (a plain function), not a `<Can>` JSX wrapper.** A `<Can>`
  component did once exist (deleted in commit `8cd8176`), but it depended on
  `usePermission`/`useAnyPermission`/`useSession` (`@/hooks/use-session`) — a whole
  session-hook layer *also* deleted in the same sweep and not part of this plan.
  Reviving `<Can>` means reviving that layer too, well beyond gating two buttons.
  `apps/dashboard/AGENTS.md`'s own current text (not the deleted component) says a
  per-action gate "is not built yet... the first screen that needs action-level gating
  adds it to `src/components/`, backed by `src/lib/permissions.ts`" — `hasPermission`
  is exactly that starting point, and a future `<Can>` can be built on top of it and
  `useCurrentUser` without redoing either.
- **Hand-written `BackgroundJobRecord`/`JobStatus`, not types derived from
  `ApiSchemas["BackgroundJob"]`.** This mirrors `dashboard-service.ts`'s own explicit,
  already-documented convention for this exact app: "wire types below are hand-declared,
  minimal subsets of the real API records... only the fields these widgets actually
  read." Every other type in this plan (`StaffDetailRecord`, `Page<T>`, etc.) already
  follows this, not the generated schema.
- **`endpoints.dashboard.staffExports`/`.staffImports`, not a new `endpoints.staff`
  domain; `fetchFileDownloadUrl` stays in `Services.jobs`, not `Services.files`.**
  ADR-0011's text requires new staff *calls* to live in `services/modules/staff/`
  (done — Task 3) but says nothing about endpoint-path namespacing, and
  `fetchFileDownloadUrl` is exactly as platform-level as `fetchJob` (this plan's own
  jobs-service docstring already frames `core.jobs`/`core.files` together as one
  "`202 + job` contract"). Neither move is wrong, but neither is required either;
  moving both now is churn without a correctness payoff.
- **No new ADR** for the job-polling pattern — `apps/dashboard/AGENTS.md`'s wiring
  table gets a `useJobPolling`/`hasPermission` row instead (Task 5, Step 5), which is
  what actually routes a future contributor to this pattern; an ADR record for a
  frontend polling convention would be new ceremony this repo's existing ADRs don't
  establish a precedent for (its ADRs record backend/tenancy/contract decisions).
- **A bare `title` attribute on the disabled buttons' wrapping `<span>`**, not
  `aria-describedby` pointing at a visually-hidden reason. Real accessibility gap (a
  `title` is not reliably reachable by keyboard or assistive tech), but it exactly
  matches this same file's own pre-existing pattern for the same button before this
  plan touched it — not a regression this plan introduces, and worth its own follow-up
  across every disabled-button-with-a-reason case in this app, not a one-off fix here.

## Review Focus

1. **Celery worker down / job never reaches a terminal status.** The hook's timeout
   must actually reach a re-render the UI can act on — a value nobody ever reads again
   isn't a fix. Owned by Task 2, and this is exactly where the first review round found
   a real bug (see Task 2's own note).
2. **The poll request itself fails** (a 5xx or network error on `GET /jobs/{id}`, not a
   job that failed). Must stop polling and report an error state rather than retrying
   forever or silently doing nothing. Owned by Task 2.
3. **The export job succeeds, but fetching its download URL fails** afterward (an
   object-storage hiccup between `succeeded` and the `:download` call). Must surface an
   error, not silently do nothing once the spinner stops. Owned by Task 5.
4. **The import file fails at two different points, for two different reasons**: a
   file over the 5&nbsp;MB cap is rejected *synchronously* by `POST /staff-imports`
   itself (a real `422`), while an unparseable-but-under-the-cap file still queues a
   job that later reaches `status: "failed"` with raw exception text in `error`
   (`import_staff_task`'s own `except Exception: mark_failed(job=job, error=str(exc))`).
   Both need to reach the user correctly — the synchronous one through
   `ApiError`/`errors.*` mapping, the asynchronous one as the job's own failure state.
   Owned by Task 4.
5. **The import job succeeds with a MIX of successful and failed rows** (the normal
   case: `import_staff_row` commits each row independently). Both the succeeded count
   and the per-row error table must show — showing only one hides either the partial
   win or the rows still needing a fix. Mirrors `exit-staff-dialog.tsx`'s existing
   partial-failure precedent. Owned by Task 4.
6. **A role that can see every other action on this screen, but not this one**
   (`school_admin`: `RECORD_MANAGERS`, not `STAFF_IO`) must see both buttons disabled
   with a reason, never a live button that always 403s. Owned by Task 3 (the helper)
   and Task 5 (wiring it into the toolbar, plus the e2e proof against the real default
   test user).

---

## File Structure

- `apps/dashboard/src/services/endpoints.ts` — **modify**: add `dashboard.staffExports`,
  `dashboard.staffImports`, `files.download`, and a new `jobs` domain.
- `apps/dashboard/src/services/modules/jobs/jobs-service.ts` — **create**: generic
  `fetchJob`/`fetchFileDownloadUrl` plus the shared `BackgroundJobRecord`/`JobStatus`/
  `ImportJobResult`/`ImportRowError`/`ExportJobResult` types (platform infra, not
  staff-specific — mirrors `modules/files/`).
- `apps/dashboard/src/services/modules/jobs/index.ts` — **create**: `JobsService`
  barrel, same shape as `modules/files/index.ts`.
- `apps/dashboard/src/services/index.ts` — **modify**: register `Services.jobs` and
  `Services.staff`.
- `apps/dashboard/src/services/__tests__/index.test.ts` — **modify**: the aggregate
  test asserts the exact set of `Services` keys — updated twice (Task 1 adds `jobs`,
  Task 3 adds `staff`).
- `apps/dashboard/src/hooks/use-job-polling.ts` — **create**: the shared
  poll-until-terminal-or-timeout hook both features use.
- `apps/dashboard/src/hooks/__tests__/use-job-polling.test.tsx` — **create**.
- `apps/dashboard/src/hooks/use-current-user.ts` — **create**: shared current-user
  query, behind the query-key factory (avoids a new `INLINE_QUERY_KEY` violation in
  `staff-toolbar.tsx`, whose baseline is frozen).
- `apps/dashboard/src/services/modules/staff/staff-service.ts` — **create**: new
  `Services.staff` module (ADR-0011) with `triggerStaffExport`/`triggerStaffImport`.
- `apps/dashboard/src/services/modules/staff/index.ts` — **create**: `StaffService`
  barrel.
- `apps/dashboard/src/services/modules/staff/__tests__/staff-service.test.ts` —
  **create**.
- `apps/dashboard/src/lib/permissions.ts` — **modify**: add `hasPermission`.
- `apps/dashboard/src/lib/__tests__/permissions.test.ts` — **create**.
- `apps/dashboard/src/lib/query-client.ts` — **modify**: add `queryKeys.currentUser()`.
- `apps/dashboard/src/app/(app)/staff/staff-import-dialog.tsx` — **create**: the real
  dialog, first time, no placeholder.
- `apps/dashboard/src/app/(app)/staff/__tests__/staff-import-dialog.test.tsx` —
  **create**.
- `apps/dashboard/src/app/(app)/staff/staff-toolbar.tsx` — **modify**: a new, real
  "Export CSV" button (today's toolbar has no export button at all — only a permanently
  `disabled` button that is itself mislabeled "Import CSV"), and that existing button
  now genuinely opens the real
  `StaffImportDialog`, both permission-gated.
- `apps/dashboard/src/app/(app)/staff/__tests__/staff-toolbar.test.tsx` — **modify**.
- `apps/dashboard/messages/en.json`, `apps/dashboard/messages/ur.json` — **modify**: add
  `staff.import.startFailed`, `staff.import.timedOut`, `staff.import.close`.
- `e2e/src/mocks/domains/jobs.ts` — **create**: `jobsModule()` stubbing `GET /jobs/{id}`
  (configurable poll sequence) and `POST /files/{id}:download`.
- `e2e/src/mocks/domains/staff.ts` — **modify**: add fixed-id stubs for
  `POST /staff-exports`/`POST /staff-imports`.
- `e2e/src/mocks/index.ts` — **modify**: export the new `jobs` domain.
- `e2e/src/pages/dashboard/staff.page.ts` — **modify**: locators for the two toolbar
  buttons and the import dialog.
- `e2e/tests/dashboard/staff.spec.ts` — **modify**: one golden-path test per feature
  (nested under a `test.use({authUser: ...})` override with the export/import
  permissions), plus one proving the *default* (`school_admin`) test user sees both
  disabled.
- `docs/project-status.md`, `docs/deferred-work.md`, `apps/dashboard/AGENTS.md` —
  **modify**.

---

### Task 1: Generic jobs/files-download service

**Files:**
- Create: `apps/dashboard/src/services/modules/jobs/jobs-service.ts`
- Create: `apps/dashboard/src/services/modules/jobs/index.ts`
- Create: `apps/dashboard/src/services/modules/jobs/__tests__/jobs-service.test.ts`
- Modify: `apps/dashboard/src/services/endpoints.ts`
- Modify: `apps/dashboard/src/services/index.ts`
- Modify: `apps/dashboard/src/services/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `apiClient` (`@/lib/auth`), `endpoints` (`@/services/endpoints`) — both
  existing.
- Produces: `JobStatus`, `BackgroundJobRecord`, `ImportRowError`, `ImportJobResult`,
  `ExportJobResult` (all types), `fetchJob(id: string): Promise<BackgroundJobRecord>`,
  `fetchFileDownloadUrl(fileId: string): Promise<string>` — exported from
  `services/modules/jobs/jobs-service.ts` and re-exported as `Services.jobs.fetchJob`/
  `Services.jobs.fetchFileDownloadUrl` via `@/services`. Consumed by Task 2 (the hook),
  Task 3 (`triggerStaffExport`'s caller narrows its job's `result` to
  `ExportJobResult`), Task 4 (`ImportJobResult`/`ImportRowError`), Task 5 (`ExportJobResult`).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/dashboard/src/services/modules/jobs/__tests__/jobs-service.test.ts
import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("jobs-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  describe("fetchJob", () => {
    it("reads GET /jobs/{id} and returns the job record", async () => {
      const { fetchJob } = await import("../jobs-service");
      mockGet.mockResolvedValue({
        data: {
          id: "job-1",
          job_type: "export.staff",
          status: "running",
          progress: 40,
          result: null,
          error: null,
        },
      });

      const job = await fetchJob("job-1");

      expect(mockGet).toHaveBeenCalledWith("/jobs/job-1");
      expect(job).toEqual({
        id: "job-1",
        job_type: "export.staff",
        status: "running",
        progress: 40,
        result: null,
        error: null,
      });
    });
  });

  describe("fetchFileDownloadUrl", () => {
    it("posts the files:download colon-action and returns the signed URL", async () => {
      const { fetchFileDownloadUrl } = await import("../jobs-service");
      mockPost.mockResolvedValue({ data: { download_url: "https://storage.test/x.csv" } });

      const url = await fetchFileDownloadUrl("file-1");

      expect(mockPost).toHaveBeenCalledWith("/files/file-1:download");
      expect(url).toBe("https://storage.test/x.csv");
    });
  });
});
```

- [ ] **Step 2: Confirm the test fails by construction (do not run it)**

Root `AGENTS.md` and the user's own global instructions forbid running tests locally,
with no TDD carve-out for a red/green check. `../jobs-service` doesn't exist yet, so
this test cannot even collect — that's the "red" state, established by inspection, not
by execution. CI's `Test (coverage)` job is what confirms the real red→green
transition once Steps 3–4 below are pushed alongside it.

- [ ] **Step 3: Add the endpoint paths**

In `apps/dashboard/src/services/endpoints.ts`, inside `dashboard: { ... }` right after
`staffExit: (id: string) => \`/staff/${id}:exit\`,`:

```ts
    /** `POST /staff-exports`/`POST /staff-imports` -> `202` + job
     * (`apps/api/apps/staff_management/staff/urls.py`) — each queues a `core.jobs`
     * background job; poll it via `jobs.detail` below. */
    staffExports: "/staff-exports",
    staffImports: "/staff-imports",
```

Inside `files: { ... }`, right after `confirm: (id: string) => \`/files/${id}:confirm\`,`:

```ts
    /** Colon-action, not a nested path — the real registered route is
     * `/files/{id}:download` (`apps/api/core/files/urls.py`). Returns
     * `{download_url}`, a signed, time-limited URL the browser can navigate to
     * directly — never proxied through this API. */
    download: (id: string) => `/files/${id}:download`,
```

After the closing `}` of `files: { ... },`, add a new top-level domain:

```ts
  /**
   * `core.jobs` — the generic `202 + job` polling contract any long-running endpoint
   * hands back a `job_id` for (staff import/export today; more later). Not
   * module-specific, same reasoning as `files` above.
   */
  jobs: {
    detail: (id: string) => `/jobs/${id}`,
  },
```

- [ ] **Step 4: Write the service**

```ts
// apps/dashboard/src/services/modules/jobs/jobs-service.ts
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * `core.jobs`/`core.files` — the platform-level `202 + job` contract (api-architecture.md
 * §2.7–§2.8), not scoped to any one module. A caller kicks off a long-running operation
 * through its own module's trigger (e.g. `Services.staff.triggerStaffExport`), then
 * polls the returned job id through this file — see `@/hooks/use-job-polling`.
 */

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** The subset of `BackgroundJobSerializer`'s fields (`apps/api/core/jobs/serializers.py`)
 * every caller needs. `result`'s real shape is module-specific — narrow it with
 * `ImportJobResult`/`ExportJobResult` below once `status` is `"succeeded"`. */
export interface BackgroundJobRecord {
  id: string;
  job_type: string;
  status: JobStatus;
  progress: number;
  result: Record<string, unknown> | null;
  error: string | null;
}

/** One failed row from a bulk import — `import_staff_row`'s return shape, verbatim
 * (`apps/api/apps/staff_management/staff/services/import_staff.py`). The student
 * import task returns the identical shape (`apps/api/apps/student_management/
 * tasks.py`), so this is shared, not staff-specific. */
export interface ImportRowError {
  row: number;
  field: string;
  issue: string;
}

/** A finished import job's `result` — identical across every `import.<module>` task:
 * rows commit independently, so `failed > 0` alongside `succeeded > 0` is the normal
 * partial-success case, not an edge case. */
export interface ImportJobResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: ImportRowError[];
}

/** A finished export job's `result` — `{result_file_id}`, the same shape every
 * `export.<module>` task returns (`mark_succeeded(job=job, result={"result_file_id":
 * ...})`). Pass `result_file_id` to `fetchFileDownloadUrl` for the actual URL. */
export interface ExportJobResult {
  result_file_id: string;
}

/** `GET /jobs/{id}` — the one poll a `useJobPolling` caller repeats until this reaches
 * a terminal status. */
export async function fetchJob(id: string): Promise<BackgroundJobRecord> {
  const { data } = await apiClient.get<BackgroundJobRecord>(endpoints.jobs.detail(id));
  return data;
}

/** `POST /files/{id}:download` — a signed, time-limited URL for a finished job's result
 * file (or any other `core.files` record). Not proxied: the browser navigates to this
 * URL directly, the same object-storage-URL pattern `files-service.ts`'s upload flow
 * already uses for `upload_url`. */
export async function fetchFileDownloadUrl(fileId: string): Promise<string> {
  const { data } = await apiClient.post<{ download_url: string }>(
    endpoints.files.download(fileId),
  );
  return data.download_url;
}
```

```ts
// apps/dashboard/src/services/modules/jobs/index.ts
import { fetchFileDownloadUrl, fetchJob } from "./jobs-service";

export const JobsService = {
  fetchJob,
  fetchFileDownloadUrl,
};

export type {
  BackgroundJobRecord,
  ExportJobResult,
  ImportJobResult,
  ImportRowError,
  JobStatus,
} from "./jobs-service";
```

In `apps/dashboard/src/services/index.ts`, add the import:

```ts
import { JobsService } from "./modules/jobs";
```

and inside the `Services` object, alongside `files: FilesService,`:

```ts
  jobs: JobsService,
```

(Task 3 adds `staff: StaffService,` next to it — don't add a `Services.staff` line here
yet; that module doesn't exist until Task 3.)

Note (do not run locally — CI's `Test (coverage)` job confirms this): the two tests
from Step 1 now pass against the implementation above.

- [ ] **Step 5: Update the existing aggregate test**

`apps/dashboard/src/services/__tests__/index.test.ts:33` asserts the exact set of
`Services`'s top-level keys — adding `jobs` above means this now-existing test would
fail against the real `Services` object unless it's told about the new key in the
same commit. Change:

```ts
    expect(Object.keys(Services).sort()).toEqual(["auth", "dashboard", "files", "tenant"]);
```

to:

```ts
    expect(Object.keys(Services).sort()).toEqual(["auth", "dashboard", "files", "jobs", "tenant"]);
```

and add, alongside the file's existing `expect(typeof Services.files.uploadFile).toBe("function");`:

```ts
    expect(typeof Services.jobs.fetchJob).toBe("function");
    expect(typeof Services.jobs.fetchFileDownloadUrl).toBe("function");
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/services/endpoints.ts \
        apps/dashboard/src/services/index.ts \
        apps/dashboard/src/services/modules/jobs \
        apps/dashboard/src/services/__tests__/index.test.ts
git commit -m "feat(dashboard): add a generic jobs/files-download service"
```

---

### Task 2: `useJobPolling` hook

**Why this task changed after review:** the first draft computed `isTimedOut` from
`Date.now()` read during render, backed by a `useRef` for the start time. That is
broken two ways, both confirmed by reading TanStack Query v5's own re-render logic
(`useBaseQuery.js`/`queryObserver.js`, tracked-result notify path): (1) `useQuery` only
re-renders this component when a value it actually *reads* (`query.data`, `isError`,
etc.) changes; an unchanging "still running" poll response leaves `data` referentially
the same, so once polling stops there is nothing left to trigger a re-render, and
`isTimedOut` — computed fresh only on a render that was never going to happen — never
reaches the UI. (2) The ref held the *previous* job's start time until the reset
`useEffect` ran, so a fresh job whose own effect hadn't fired yet could read a stale
timestamp and appear to time out immediately. This version drives the timeout with a
`setTimeout` whose callback calls `setState` — a real state update that *does* trigger
a re-render — and uses `skipToken` (TanStack's own documented way to make a query
conditionally disabled) instead of a hand-written `enabled` + cast.

**Files:**
- Create: `apps/dashboard/src/hooks/use-job-polling.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-job-polling.test.tsx`

**Interfaces:**
- Consumes: `Services.jobs.fetchJob` (Task 1), `BackgroundJobRecord`/`JobStatus`
  (Task 1, imported as types), `queryKeys` (`@/lib/query-client`, existing).
- Produces: `useJobPolling(module: string, jobId: string | null): { job:
  BackgroundJobRecord | undefined; isPolling: boolean; isTimedOut: boolean; isError:
  boolean }`, consumed by Task 4 (import dialog) and Task 5 (toolbar export button).
  `module` namespaces the query key (e.g. `"staff"`) so two features polling different
  jobs at once never collide on one cache entry.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/dashboard/src/hooks/__tests__/use-job-polling.test.tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Services } from "@/services";

import { useJobPolling } from "../use-job-polling";

jest.mock("@/services", () => ({
  Services: { jobs: { fetchJob: jest.fn() } },
}));

const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<
  typeof Services.jobs.fetchJob
>;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useJobPolling", () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    mockFetchJob.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does nothing while jobId is null", () => {
    const { result } = renderHook(() => useJobPolling("staff", null), { wrapper });
    expect(result.current.job).toBeUndefined();
    expect(result.current.isPolling).toBe(false);
    expect(mockFetchJob).not.toHaveBeenCalled();
  });

  it("polls until the job reaches succeeded, then stops", async () => {
    mockFetchJob
      .mockResolvedValueOnce({
        id: "job-1",
        job_type: "export.staff",
        status: "running",
        progress: 10,
        result: null,
        error: null,
      })
      .mockResolvedValueOnce({
        id: "job-1",
        job_type: "export.staff",
        status: "succeeded",
        progress: 100,
        result: { result_file_id: "file-1" },
        error: null,
      });

    const { result } = renderHook(() => useJobPolling("staff", "job-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("running");
    });
    expect(result.current.isPolling).toBe(true);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("succeeded");
    });
    expect(result.current.isPolling).toBe(false);

    const callsAtSuccess = mockFetchJob.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    // No further polling once terminal — a third call would mean refetchInterval
    // didn't actually stop.
    expect(mockFetchJob.mock.calls.length).toBe(callsAtSuccess);
  });

  it("times out — and the timeout actually reaches a re-render — when the job never reaches a terminal status", async () => {
    mockFetchJob.mockResolvedValue({
      id: "job-2",
      job_type: "export.staff",
      status: "running",
      progress: 0,
      result: null,
      error: null,
    });

    const { result } = renderHook(() => useJobPolling("staff", "job-2"), { wrapper });

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true);
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });

    // This assertion is the one the first review round's plan failed: a hook that
    // merely computes `isTimedOut` correctly but never re-renders would leave
    // `result.current` stuck at its last-observed value, and `waitFor` would time out.
    await waitFor(() => {
      expect(result.current.isTimedOut).toBe(true);
    });
    expect(result.current.isPolling).toBe(false);
  });

  it("gives a freshly-triggered job its own full timeout budget, not the previous job's", async () => {
    mockFetchJob.mockResolvedValue({
      id: "job-a",
      job_type: "export.staff",
      status: "running",
      progress: 0,
      result: null,
      error: null,
    });

    const { result, rerender } = renderHook(
      ({ jobId }: { jobId: string }) => useJobPolling("staff", jobId),
      { wrapper, initialProps: { jobId: "job-a" } },
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });
    await waitFor(() => {
      expect(result.current.isTimedOut).toBe(true);
    });

    rerender({ jobId: "job-b" });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    // Only 10s of job-b's own 120s budget has elapsed — a hook that carried over
    // job-a's already-expired timer would report this as timed out immediately.
    expect(result.current.isTimedOut).toBe(false);
    expect(result.current.isPolling).toBe(true);
  });

  it("never reports isTimedOut for a job that already succeeded, even long after", async () => {
    mockFetchJob.mockResolvedValue({
      id: "job-4",
      job_type: "export.staff",
      status: "succeeded",
      progress: 100,
      result: { result_file_id: "file-1" },
      error: null,
    });

    const { result } = renderHook(() => useJobPolling("staff", "job-4"), { wrapper });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("succeeded");
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(130_000);
    });

    // The 120s timer set on mount is still running underneath, but a job that
    // finished successfully must never be reported as timed out just because that
    // timer eventually fires.
    expect(result.current.isTimedOut).toBe(false);
  });

  it("stops polling and reports isError when the poll request itself fails", async () => {
    mockFetchJob.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useJobPolling("staff", "job-3"), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.isPolling).toBe(false);

    const callsAtError = mockFetchJob.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(mockFetchJob.mock.calls.length).toBe(callsAtError);
  });
});
```

- [ ] **Step 2: Confirm the test fails by construction (do not run it)**

`../use-job-polling` doesn't exist yet, so this test cannot even collect — the "red"
state, established by inspection, not execution (see Global Constraints on why no
`Run: npx jest ...` step appears anywhere in this plan).

- [ ] **Step 3: Write the hook**

```ts
// apps/dashboard/src/hooks/use-job-polling.ts
"use client";

import { useEffect, useState } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";

const POLL_INTERVAL_MS = 2000;
/** ~2 minutes — long enough for a real CSV export/import, short enough that a stuck
 * worker doesn't leave the UI spinning forever (Review Focus #1). */
const MAX_POLL_DURATION_MS = 120_000;

export interface JobPollingResult {
  job: BackgroundJobRecord | undefined;
  /** True while an actual poll is scheduled — false once terminal, timed out,
   * errored, or `jobId` is null. */
  isPolling: boolean;
  isTimedOut: boolean;
  /** True once the poll request itself has failed (Review Focus #2) — distinct from
   * the job itself reaching `status: "failed"`, which is a normal terminal state the
   * request succeeded in reporting. */
  isError: boolean;
}

/**
 * Polls `GET /jobs/{id}` (via `Services.jobs.fetchJob`) at `POLL_INTERVAL_MS` until the
 * job reaches `succeeded`/`failed`, the poll request itself errors, or
 * `MAX_POLL_DURATION_MS` elapses first. `module` namespaces the query key (e.g.
 * `"staff"`) so two features polling different jobs never collide on one cache entry.
 *
 * The timeout is a `setTimeout` whose callback calls `setTimedOutJobId` — not a
 * `Date.now()` comparison read during render. `useQuery` only re-renders this
 * component when a value it actually reads changes, and an unchanging "still running"
 * poll response leaves `data` referentially the same — nothing would ever re-render on
 * its own once polling stopped producing new data, so a render-time clock check could
 * compute the right answer and still never reach the UI. The state update below is
 * what actually schedules a re-render; resetting per `jobId` (the effect's own
 * dependency) is what gives a fresh job its own full budget rather than inheriting a
 * previous job's already-expired one.
 */
export function useJobPolling(module: string, jobId: string | null): JobPollingResult {
  const [timedOutJobId, setTimedOutJobId] = useState<string | null>(null);

  useEffect(() => {
    if (jobId === null) return undefined;
    const timer = setTimeout(() => {
      setTimedOutJobId(jobId);
    }, MAX_POLL_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [jobId]);

  // The RAW timer firing — used only to stop the query (`skipToken` below). Reported
  // `isTimedOut` (the return value) is narrower: see the second review round's own
  // Critical finding — the timer has no idea whether the job already finished, so
  // without gating on `isTerminal`/`isError` below, a job that succeeded in, say,
  // 5 seconds would still flip this to `true` 120 seconds later (the timer set on
  // mount keeps running regardless), producing a false "still running" toast on a
  // completely finished, successful job.
  const rawTimedOut = jobId !== null && jobId === timedOutJobId;

  const query = useQuery({
    queryKey: queryKeys.detail(module, "jobs", jobId ?? "none"),
    queryFn: jobId !== null && !rawTimedOut ? () => Services.jobs.fetchJob(jobId) : skipToken,
    // Polling a background job the user is actively waiting on is exactly the case
    // this option exists for — without it, TanStack Query pauses polling the moment
    // the tab loses focus, and a user who switches tabs mid-export would come back to
    // a false timeout instead of their finished file.
    refetchIntervalInBackground: true,
    refetchInterval: (latest) => {
      const status = latest.state.data?.status;
      if (status === "succeeded" || status === "failed") return false;
      if (latest.state.status === "error") return false;
      return POLL_INTERVAL_MS;
    },
  });

  const job = query.data;
  const isTerminal = job?.status === "succeeded" || job?.status === "failed";
  const isTimedOut = rawTimedOut && !isTerminal && !query.isError;

  return {
    job,
    isPolling: jobId !== null && !isTerminal && !isTimedOut && !query.isError,
    isTimedOut,
    isError: query.isError,
  };
}
```

Note (do not run locally): CI's `Test (coverage)` job confirms all 6 tests pass
against the implementation above, including the two regression tests for the second
review round's Critical finding (a false timeout on an already-succeeded job) and the
fresh-job-gets-its-own-budget case.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/hooks
git commit -m "feat(dashboard): add a shared job-polling hook"
```

---

### Task 3: `Services.staff` module + permission helper

**Why this task changed after review:** the first draft added `triggerStaffExport`/
`triggerStaffImport` to `Services.dashboard` — ADR-0011's own text says new staff calls
belong in `services/modules/staff/`. It also had no permission gate at all — Global
Constraints above explains why one is required here, not deferred.

**Files:**
- Create: `apps/dashboard/src/services/modules/staff/staff-service.ts`
- Create: `apps/dashboard/src/services/modules/staff/index.ts`
- Create: `apps/dashboard/src/services/modules/staff/__tests__/staff-service.test.ts`
- Modify: `apps/dashboard/src/services/index.ts`
- Modify: `apps/dashboard/src/services/__tests__/index.test.ts`
- Modify: `apps/dashboard/src/lib/permissions.ts`
- Create: `apps/dashboard/src/lib/__tests__/permissions.test.ts`
- Modify: `apps/dashboard/src/lib/query-client.ts`
- Create: `apps/dashboard/src/hooks/use-current-user.ts`

**Interfaces:**
- Consumes: `apiClient`, `endpoints.dashboard.staffExports`/`staffImports` (Task 1);
  `AuthenticatedUser` (`@schoolhub/types`, existing).
- Produces: `triggerStaffExport(): Promise<{jobId: string}>`,
  `triggerStaffImport(file: File): Promise<{jobId: string}>` (re-exported as
  `Services.staff.triggerStaffExport`/`triggerStaffImport` — consumed by Task 4 and
  Task 5); `hasPermission(user: AuthenticatedUser | undefined, key: PermissionKey):
  boolean` (`@/lib/permissions`); `useCurrentUser()` (`@/hooks/use-current-user`,
  wrapping the same `["dashboard", "current-user"]` query `sidebar-menu.tsx` already
  uses, now behind `queryKeys.currentUser()` instead of a second inline literal array)
  — both consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/dashboard/src/services/modules/staff/__tests__/staff-service.test.ts
import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: jest.fn(),
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("staff-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockPost.mockReset();
  });

  describe("triggerStaffExport", () => {
    it("posts /staff-exports and returns the queued job's id", async () => {
      const { triggerStaffExport } = await import("../staff-service");
      mockPost.mockResolvedValue({ data: { job_id: "job-export-1", status: "queued" } });

      const result = await triggerStaffExport();

      expect(mockPost).toHaveBeenCalledWith("/staff-exports");
      expect(result).toEqual({ jobId: "job-export-1" });
    });
  });

  describe("triggerStaffImport", () => {
    it("posts /staff-imports as multipart form data and returns the queued job's id", async () => {
      const { triggerStaffImport } = await import("../staff-service");
      mockPost.mockResolvedValue({ data: { job_id: "job-import-1", status: "queued" } });
      const file = new File(["a,b\n1,2"], "staff.csv", { type: "text/csv" });

      const result = await triggerStaffImport(file);

      expect(mockPost).toHaveBeenCalledWith("/staff-imports", expect.any(FormData));
      const body = mockPost.mock.calls[0]?.[1] as FormData;
      expect(body.get("file")).toBe(file);
      expect(result).toEqual({ jobId: "job-import-1" });
    });
  });
});
```

```ts
// apps/dashboard/src/lib/__tests__/permissions.test.ts
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

import { hasPermission } from "../permissions";

/** A complete, minimal `AuthenticatedUser` — every field is required by the real
 * type (`packages/types/src/auth.ts`), so a partial cast here would let a genuine
 * typo in `hasPermission`'s own signature go unnoticed by `tsc`. */
function userWith(permissions: PermissionKey[]): AuthenticatedUser {
  return {
    id: "user-1",
    email: "user@example.com",
    phone: null,
    full_name: "Test User",
    avatar_url: null,
    locale: "en",
    tenant_id: "tenant-1",
    roles: [],
    permissions,
  };
}

describe("hasPermission", () => {
  it("is true when the user holds the exact key", () => {
    expect(hasPermission(userWith(["staff.staff.export"]), "staff.staff.export")).toBe(true);
  });

  it("is false when the user holds other staff keys but not this one", () => {
    expect(hasPermission(userWith(["staff.staff.view", "staff.staff.update"]), "staff.staff.export")).toBe(
      false,
    );
  });

  it("is false for an undefined user (still loading)", () => {
    expect(hasPermission(undefined, "staff.staff.export")).toBe(false);
  });
});
```

- [ ] **Step 2: Confirm the tests fail by construction (do not run them)**

`../staff-service` doesn't exist yet, and `hasPermission` isn't exported yet — both
fail to even collect.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/services/modules/staff/staff-service.ts
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * New staff-module API calls land here, per ADR-0011 ("staff calls belong in
 * services/modules/staff/, not in Services.dashboard"). The pre-existing staff calls
 * in `services/modules/dashboard/dashboard-service.ts` (`fetchStaffPage`,
 * `createStaff`, etc.) are that ADR's own already-tracked drift — moving them is a
 * separate, unrelated migration, not part of wiring up two new buttons.
 */

/** `POST /staff-exports` -> `202` + job (module doc §16). The job's `result` on
 * success is `ExportJobResult` (`@/services/modules/jobs/jobs-service`) — pass its
 * `result_file_id` to `Services.jobs.fetchFileDownloadUrl` for the actual download
 * URL. */
export async function triggerStaffExport(): Promise<{ jobId: string }> {
  const { data } = await apiClient.post<{ job_id: string; status: string }>(
    endpoints.dashboard.staffExports,
  );
  return { jobId: data.job_id };
}

/** `POST /staff-imports` (multipart) -> `202` + job. `file` must be `.csv` or
 * `.xlsx`, capped server-side at 5 MB
 * (`apps/api/apps/staff_management/staff/viewset.py`) — a file outside those limits
 * comes back as a real `ApiError` from THIS call. A file that parses but whose rows
 * fail comes back as a `"failed"` job instead (see `ImportJobResult`) — the two
 * failure modes are genuinely different and are handled separately by
 * `StaffImportDialog` (Task 4). */
export async function triggerStaffImport(file: File): Promise<{ jobId: string }> {
  const body = new FormData();
  body.append("file", file);
  const { data } = await apiClient.post<{ job_id: string; status: string }>(
    endpoints.dashboard.staffImports,
    body,
  );
  return { jobId: data.job_id };
}
```

```ts
// apps/dashboard/src/services/modules/staff/index.ts
import { triggerStaffExport, triggerStaffImport } from "./staff-service";

export const StaffService = {
  triggerStaffExport,
  triggerStaffImport,
};
```

In `apps/dashboard/src/services/index.ts`, add:

```ts
import { StaffService } from "./modules/staff";
```

and, inside the `Services` object, alongside `jobs: JobsService,`:

```ts
  staff: StaffService,
```

In `apps/dashboard/src/lib/permissions.ts`, append after `canAccessModule`:

```ts
/**
 * True when the signed-in user holds this exact permission key — the per-action
 * counterpart to `canAccessModule`'s whole-module check. `apps/dashboard/AGENTS.md`'s
 * wiring table names this as the thing to add "when the first screen needs
 * action-level gating": `staff.staff.export`/`.import` are granted to `STAFF_IO`
 * (`hr_staff`, `it_admin`), narrower than `RECORD_MANAGERS` (`hr_staff`,
 * `school_admin`) who already see every other action on this screen — rendering
 * these two buttons unconditionally would show a `school_admin` two buttons that
 * always 403.
 */
export function hasPermission(user: AuthenticatedUser | undefined, key: PermissionKey): boolean {
  return user?.permissions.includes(key) ?? false;
}
```

Add `PermissionKey` to this file's existing `import type { AuthenticatedUser } from
"@schoolhub/types";` line, making it `import type { AuthenticatedUser, PermissionKey }
from "@schoolhub/types";` — `permissions` is typed `PermissionKey[]` (a template
literal type, `` `${string}.${string}.${string}` ``), not `string[]`, so `key: string`
fails `tsc` (`Array<PermissionKey>.includes` only accepts a `PermissionKey`). A plain
string literal like `"staff.staff.export"` at a call site still satisfies
`PermissionKey` automatically — only the parameter's own declared type needed fixing.

Note (do not run locally): CI's `Test (coverage)` job confirms both new test files
pass against the implementation above.

- [ ] **Step 4: Update the existing aggregate test again**

Task 1 already updated `apps/dashboard/src/services/__tests__/index.test.ts` for the
new `jobs` key. Update it once more for `staff`:

```ts
    expect(Object.keys(Services).sort()).toEqual(["auth", "dashboard", "files", "jobs", "staff", "tenant"]);
```

and add, alongside the `Services.jobs.*` assertions Task 1 added:

```ts
    expect(typeof Services.staff.triggerStaffExport).toBe("function");
    expect(typeof Services.staff.triggerStaffImport).toBe("function");
```

- [ ] **Step 5: Add a shared `useCurrentUser` hook, behind the query-key factory**

`staff-toolbar.tsx` (Task 5) needs the signed-in user's permissions to gate the
Export/Import buttons. `sidebar-menu.tsx` already fetches the identical
`["dashboard", "current-user"]` query inline (as do `entry-callout.tsx` and
`user-dropdown-menu.tsx`) — adding a second inline copy of that same literal array in
`staff-toolbar.tsx` would trip `INLINE_QUERY_KEY` (`no-restricted-syntax`), whose
baseline for that exact file is frozen at its *current* count
(`apps/dashboard/eslint-suppressions.json`'s `src/app/(app)/staff/staff-toolbar.tsx` →
`no-restricted-syntax: 2`) — ADR-0014's ratchet means CI fails the moment a file's own
count goes up, not just when the repo-wide total does. Routing this one call through
the `queryKeys` factory instead avoids adding a literal at all. (The three other
call sites are pre-existing, working code this plan doesn't touch — consolidating them
onto this same hook is a reasonable follow-up, not part of wiring up two buttons.)

In `apps/dashboard/src/lib/query-client.ts`, add one entry to the existing `queryKeys`
object, alongside `tenant: () => ["tenant"] as const,`:

```ts
  currentUser: () => ["dashboard", "current-user"] as const,
```

```ts
// apps/dashboard/src/hooks/use-current-user.ts
"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

/** The signed-in user — the same cache entry `sidebar-menu.tsx`'s own module gate,
 * `entry-callout.tsx`'s greeting, and `user-dropdown-menu.tsx` already populate
 * (identical `queryKeys.currentUser()` key), so this never issues a second request. */
export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.currentUser(),
    queryFn: () => Services.auth.fetchCurrentUser(),
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/services/modules/staff \
        apps/dashboard/src/services/index.ts \
        apps/dashboard/src/services/__tests__/index.test.ts \
        apps/dashboard/src/lib/permissions.ts \
        apps/dashboard/src/lib/__tests__/permissions.test.ts \
        apps/dashboard/src/lib/query-client.ts \
        apps/dashboard/src/hooks/use-current-user.ts
git commit -m "feat(dashboard): add Services.staff export/import triggers, a per-action permission helper, and a shared current-user hook"
```

---

### Task 4: Real "Import CSV" dialog

**Why this task changed after review:** the first draft was new-from-scratch and used
`aria-label` only, a bulleted list for row errors, and no columns hint. This version
ports `apps/dashboard/src/features/staff/import-wizard.tsx` (deleted in commit
`9548054`, unrelated to whether it was right), which already had a real `Label` +
`useId`, a `Table` for row errors, a required/optional columns hint, and correct
`errors.*` code-mapping — all confirmed still valid against the *current* backend
(the deleted version's own `OPTIONAL_COLUMNS` list was stale against the current
`import_staff.py`'s real column tuple and is corrected here, not copied verbatim).
It's adapted from a full page onto the current `Services.staff`/`useJobPolling` API,
built inside a `Dialog` instead of a bare page (Task 5 opens it from the toolbar), and
built as a complete, real component from the start — no placeholder stub, unlike the
first draft's Task 4/5 split.

**Files:**
- Create: `apps/dashboard/src/app/(app)/staff/staff-import-dialog.tsx`
- Create: `apps/dashboard/src/app/(app)/staff/__tests__/staff-import-dialog.test.tsx`
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/ur.json`

**Interfaces:**
- Consumes: `Services.staff.triggerStaffImport` (Task 3), `useJobPolling` (Task 2, as
  `useJobPolling("staff", ...)`), `ImportJobResult`/`ImportRowError` (Task 1),
  `queryKeys` (`@/lib/query-client`, existing).
- Produces: `StaffImportDialog({open, onOpenChange}): JSX.Element`, consumed by Task 5.

- [ ] **Step 1: Add the three missing message keys**

In `apps/dashboard/messages/en.json`, inside the existing `staff.import` object (do not
touch its other keys), add:

```json
    "startFailed": "The import could not be started.",
    "timedOut": "Still running in the background — check back shortly.",
    "close": "Close"
```

In `apps/dashboard/messages/ur.json`, inside the mirrored `staff.import` object, add:

```json
    "startFailed": "درآمد شروع نہیں ہو سکا۔",
    "timedOut": "پس منظر میں چل رہا ہے — کچھ دیر بعد دوبارہ چیک کریں۔",
    "close": "بند کریں"
```

- [ ] **Step 2: Write the failing tests**

```tsx
// apps/dashboard/src/app/(app)/staff/__tests__/staff-import-dialog.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import type { ReactNode } from "react";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import messages from "../../../../../messages/en.json";

import { StaffImportDialog } from "../staff-import-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    staff: { triggerStaffImport: jest.fn() },
    jobs: { fetchJob: jest.fn() },
  },
}));

// Same pattern exit-staff-dialog.test.tsx already uses: `renderWithProviders` mounts
// no `<Toaster/>`, so a real (unmocked) `sonner` call reaches no DOM node a test could
// assert on — several of this file's own paths (a poll error, a timeout, the
// synchronous size-cap rejection) surface ONLY as a toast, with no inline element.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

const mockTriggerStaffImport = Services.staff.triggerStaffImport as jest.MockedFunction<
  typeof Services.staff.triggerStaffImport
>;
const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

function csvFile() {
  return new File(["first_name,last_name"], "staff.csv", { type: "text/csv" });
}

describe("StaffImportDialog", () => {
  beforeEach(() => {
    mockTriggerStaffImport.mockReset();
    mockFetchJob.mockReset();
    mockToastError.mockReset();
  });

  it("renders nothing (no dialog role) when closed", () => {
    renderWithProviders(<StaffImportDialog open={false} onOpenChange={jest.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the required/optional column hint before any file is picked", () => {
    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByText("campus_code")).toBeInTheDocument();
    expect(screen.getByText("national_id")).toBeInTheDocument();
  });

  it("shows a per-row failure table when the import partially succeeds", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-1" });
    mockFetchJob.mockResolvedValue({
      id: "job-import-1",
      job_type: "import.staff",
      status: "succeeded",
      progress: 100,
      result: {
        total: 2,
        succeeded: 1,
        failed: 1,
        errors: [{ row: 3, field: "campus_code", issue: "Unknown campus code 'ZZZ'." }],
      },
      error: null,
    });

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    // Scoped to the error table specifically: "campus_code" also appears in the
    // always-rendered required/optional columns hint above the file input, so an
    // unscoped `getByText("campus_code")` would throw "found multiple elements" the
    // instant this table renders alongside it.
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("3")).toBeInTheDocument();
    expect(table.getByText("campus_code")).toBeInTheDocument();
    expect(table.getByText("Unknown campus code 'ZZZ'.")).toBeInTheDocument();
    expect(screen.getByText("1 imported")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
  });

  it("shows the server's real per-field validation message when the import file is rejected synchronously (over the size cap)", async () => {
    const { ApiError } = jest.requireActual<{ ApiError: new (init: unknown) => Error }>(
      "@schoolhub/api-client",
    );
    // `DomainRuleViolation` (`apps/api/core/api/exceptions.py`'s `default_code =
    // "domain_rule_violation"`) is the REAL code the size-cap check in
    // `StaffImportViewSet.create` raises (`viewset.py:236-239`) — not
    // `validation_error`. Its mapped `errors.domain_rule_violation` message
    // ("That action isn't allowed right now.") is generic on purpose (the code
    // covers many unrelated business rules); the actually-useful text is the
    // field-level `details` entry, which is exactly what `ApiError.fieldErrors()`
    // surfaces and what the component below must prefer.
    mockTriggerStaffImport.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Import file exceeds the 5242880-byte limit.",
        status: 422,
        url: "/staff-imports",
        details: [
          {
            field: "file",
            issue: "Import file exceeds the 5242880-byte limit.",
            code: "domain_rule_violation",
          },
        ],
      }),
    );

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Import file exceeds the 5242880-byte limit.");
    });
  });

  it("shows the job's own raw failure message when the file parses but the job itself fails asynchronously", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-2" });
    mockFetchJob.mockResolvedValue({
      id: "job-import-2",
      job_type: "import.staff",
      status: "failed",
      progress: 0,
      result: null,
      error: "Unsupported xlsx format.",
    });

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    // Rendered inline (an `Alert`), unlike the synchronous case above — this one
    // reads real DOM text, not a toast call.
    expect(await screen.findByText("Unsupported xlsx format.")).toBeInTheDocument();
  });

  it("shows an error toast when the poll request itself fails", async () => {
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-4" });
    mockFetchJob.mockRejectedValue(new Error("network error"));

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The import failed.");
    });
  });

  it("shows a timeout toast when the job never reaches a terminal status", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-5" });
    mockFetchJob.mockResolvedValue({
      id: "job-import-5",
      job_type: "import.staff",
      status: "running",
      progress: 10,
      result: null,
      error: null,
    });

    renderWithProviders(<StaffImportDialog open onOpenChange={jest.fn()} />);
    const user = userEvent.setup({ delay: null });
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await jest.advanceTimersByTimeAsync(120_000);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Still running in the background — check back shortly.");
    });
    jest.useRealTimers();
  });

  it("stops polling once the dialog is closed mid-import", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockTriggerStaffImport.mockResolvedValue({ jobId: "job-import-3" });
    mockFetchJob.mockResolvedValue({
      id: "job-import-3",
      job_type: "import.staff",
      status: "running",
      progress: 0,
      result: null,
      error: null,
    });

    const onOpenChange = jest.fn();
    // A local `wrapper` (RTL's own option, not `renderWithProviders`) is what makes
    // `rerender` re-apply the providers on every call — `renderWithProviders` returns
    // a plain `render()` result whose `rerender` swaps the ENTIRE tree for whatever
    // element it's given, providers included, so `rerender(<Wrapper open={false} />)`
    // without this option would silently drop the `QueryClientProvider`/
    // `NextIntlClientProvider` and throw the moment `useTranslations`/`useQuery` ran
    // again. Mirrors `staff-form-dialog.test.tsx`'s own identical regression test.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </NextIntlClientProvider>
      );
    }

    const { rerender } = render(<StaffImportDialog open onOpenChange={onOpenChange} />, {
      wrapper: Wrapper,
    });
    const user = userEvent.setup({ delay: null });
    await user.upload(screen.getByLabelText("File"), csvFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mockFetchJob).toHaveBeenCalledTimes(1);
    });

    // Control: still open, still polling — a second poll fires after one more
    // interval, proving the fake-timer setup actually drives this query.
    await jest.advanceTimersByTimeAsync(2000);
    await waitFor(() => {
      expect(mockFetchJob).toHaveBeenCalledTimes(2);
    });

    rerender(<StaffImportDialog open={false} onOpenChange={onOpenChange} />);

    const callsAtClose = mockFetchJob.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockFetchJob.mock.calls.length).toBe(callsAtClose);
    jest.useRealTimers();
  });
});
```

Note: `rerender` in the last test goes through `renderWithProviders`'s own return
value, which keeps the same wrapper element tree (the `Wrapper` component receiving a
new `open` prop) — this avoids the trap of calling the raw RTL `rerender` with a bare
`<StaffImportDialog .../>` that drops the `QueryClientProvider` wrapper entirely
(`useQueryClient` would then throw). `renderWithProviders` returns whatever
`@testing-library/react`'s `render` returns, `rerender` included, and that `rerender`
re-renders inside the *original* tree.

- [ ] **Step 3: Confirm the tests fail by construction (do not run them)**

`../staff-import-dialog` doesn't exist yet, so all 8 fail to even collect.

- [ ] **Step 4: Implement the dialog**

```tsx
// apps/dashboard/src/app/(app)/staff/staff-import-dialog.tsx
"use client";

import { useEffect, useId, useState, type ChangeEvent } from "react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useJobPolling } from "@/hooks/use-job-polling";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import type { ImportJobResult } from "@/services/modules/jobs/jobs-service";

export interface StaffImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACCEPTED_EXTENSIONS = ".csv,.xlsx";
/** Mirrors `REQUIRED_IMPORT_COLUMNS`/`IMPORT_COLUMNS`
 * (`apps/api/apps/staff_management/staff/services/import_staff.py`) verbatim — shown
 * so the person picking a file knows the header row's exact contract before they
 * upload it. */
const REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "staff_type",
  "campus_code",
  "joining_date",
  "phone",
];
const OPTIONAL_COLUMNS = ["gender", "date_of_birth", "email", "national_id"];

/**
 * File picker -> `POST /staff-imports` -> poll -> per-row result. Ported from this
 * app's own earlier `features/staff/import-wizard.tsx` (removed in the unrelated
 * shell-reset commit `9548054`) — same `useTranslations`/error-code-mapping/
 * columns-hint/Table-based result shape, adapted from a full page into a dialog and
 * onto the current `Services.staff`/`useJobPolling` API. Mirrors
 * `exit-staff-dialog.tsx`'s partial-success handling (a succeeded count and a failed
 * count are never mutually exclusive — `import_staff_task` commits each row
 * independently).
 */
export function StaffImportDialog({ open, onOpenChange }: StaffImportDialogProps) {
  const t = useTranslations("staff");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const fileInputId = useId();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const trigger = useMutation({
    mutationFn: (selected: File) => Services.staff.triggerStaffImport(selected),
    onSuccess: (result) => {
      setJobId(result.jobId);
    },
    onError: (error: unknown) => {
      // A field-level detail (e.g. the size-cap check's `{"file": "Import file
      // exceeds..."}`, a real `domain_rule_violation` — `apps/api/apps/
      // staff_management/staff/viewset.py:236-239`) is the useful text; the code's
      // own mapped message ("That action isn't allowed right now.") is deliberately
      // generic because that one code covers many unrelated business rules. Prefer
      // the field detail, then the code mapping, then the raw message — never invent
      // one (Hard Rule 4).
      const message =
        error instanceof ApiError
          ? (error.fieldErrors().file ??
            (tErrors.has(error.code) ? tErrors(error.code) : error.message))
          : t("import.startFailed");
      toast.error(message);
    },
  });

  // `open ? jobId : null` is what actually stops polling on close — `useJobPolling`
  // skips its query the instant this collapses to null, regardless of what `jobId`
  // state still holds.
  const { job, isPolling, isTimedOut, isError } = useJobPolling("staff", open ? jobId : null);
  const result = job?.status === "succeeded" ? (job.result as ImportJobResult | null) : null;
  const hasFinished = job?.status === "succeeded" || job?.status === "failed";

  // Depends only on `job` (plus the stable `queryClient`/`t`) — never on a value
  // derived from `job` inside the body — so `react-hooks/exhaustive-deps` is
  // satisfied without a disable comment. `job`'s reference changes on every poll
  // while running, so this re-runs on each tick, but the status checks below are
  // no-ops until the job actually reaches a terminal state.
  useEffect(() => {
    if (job?.status === "succeeded") {
      const succeededResult = job.result as ImportJobResult | null;
      if (succeededResult && succeededResult.succeeded > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("staff") });
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
      }
    }
    if (job?.status === "failed") {
      toast.error(job.error ?? t("import.failed"));
    }
  }, [job, queryClient, t]);

  useEffect(() => {
    if (isTimedOut) {
      toast.error(t("import.timedOut"));
    }
  }, [isTimedOut, t]);

  useEffect(() => {
    if (isError) {
      toast.error(t("import.failed"));
    }
  }, [isError, t]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  function handleImportClick() {
    if (file) trigger.mutate(file);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setFile(null);
      setJobId(null);
      trigger.reset();
    }
    onOpenChange(next);
  }

  const isBusy = trigger.isPending || isPolling;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent closeLabel={t("import.close")}>
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("import.description")}</p>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">{t("import.templateTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("import.templateHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {REQUIRED_COLUMNS.map((column) => (
                <Badge key={column}>{column}</Badge>
              ))}
              {OPTIONAL_COLUMNS.map((column) => (
                <Badge key={column} variant="outline">
                  {column}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={fileInputId}>{t("import.fields.file")}</Label>
            <Input
              id={fileInputId}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={handleFileChange}
              disabled={isBusy}
            />
          </div>

          {isPolling ? (
            <div className="space-y-1.5">
              <Progress value={job?.progress ?? 0} />
              <p className="text-xs text-muted-foreground">
                {t("import.processing", { progress: job?.progress ?? 0 })}
              </p>
            </div>
          ) : null}

          {hasFinished && result ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">
                  {t("import.summarySucceeded", { count: result.succeeded })}
                </Badge>
                {result.failed > 0 ? (
                  <Badge variant="destructive">
                    {t("import.summaryFailed", { count: result.failed })}
                  </Badge>
                ) : null}
              </div>
              {result.errors.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("import.errorTable.row")}</TableHead>
                        <TableHead>{t("import.errorTable.field")}</TableHead>
                        <TableHead>{t("import.errorTable.issue")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((rowError, index) => (
                        <TableRow key={`${rowError.row}-${index}`}>
                          <TableCell className="tabular-nums">{rowError.row}</TableCell>
                          <TableCell>{rowError.field}</TableCell>
                          <TableCell>{rowError.issue}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </div>
          ) : null}

          {job?.status === "failed" ? (
            <Alert variant="destructive">
              <AlertDescription>{job.error ?? t("import.failed")}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false);
            }}
            disabled={trigger.isPending}
          >
            {hasFinished ? t("import.close") : tCommon("cancel")}
          </Button>
          {!hasFinished ? (
            <Button onClick={handleImportClick} disabled={!file || isBusy}>
              {t("import.upload")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note (do not run locally): CI's `Test (coverage)` job confirms all 8 tests pass
against the implementation above, including the two added for the second review
round's Medium finding (Review Focus #2/#3 needing an assertion where users actually
see them — a mocked `toast.error`, not silence).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(app\)/staff/staff-import-dialog.tsx \
        apps/dashboard/src/app/\(app\)/staff/__tests__/staff-import-dialog.test.tsx \
        apps/dashboard/messages/en.json \
        apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add the real staff CSV import dialog"
```

---

### Task 5: Wire the toolbar's Export/Import buttons, permission gate, e2e, docs

**Why this task changed after review:** the first draft's toolbar effects called
`setExportJobId(null)` synchronously inside plain `useEffect` bodies (flagged by
`react-hooks/set-state-in-effect`) and left both buttons live for every role. This
version removes every such reset — a fresh "Export CSV" click already overwrites
`exportJobId` via the mutation's own `onSuccess`, and `isPolling` already becomes
`false` once the job hook reports terminal/timed-out/errored, so nothing needs to be
reset by hand — and adds the permission gate from Task 3. It also fixes a smaller gap
the first round flagged Low: the button used to re-enable the instant the job reached
`"succeeded"`, even though the download-URL fetch was still in flight, letting a
double-click start a second export; the download step is now its own `useMutation` so
`.isPending` covers that whole window. The e2e download-filename
assertion is also corrected: since `ResponseContentDisposition` is deliberately
deferred (Global Constraints), the mock's file URL no longer pretends the real
suggested filename would be `staff-export.csv`; the test instead asserts a download
actually happened, which is what this task's code can truthfully guarantee.

**Files:**
- Modify: `apps/dashboard/src/app/(app)/staff/staff-toolbar.tsx`
- Modify: `apps/dashboard/src/app/(app)/staff/__tests__/staff-toolbar.test.tsx`
- Create: `e2e/src/mocks/domains/jobs.ts`
- Modify: `e2e/src/mocks/domains/staff.ts`, `e2e/src/mocks/index.ts`
- Modify: `e2e/src/pages/dashboard/staff.page.ts`
- Modify: `e2e/tests/dashboard/staff.spec.ts`
- Modify: `docs/project-status.md`, `docs/deferred-work.md`

**Interfaces:**
- Consumes: `Services.staff.triggerStaffExport` (Task 3), `Services.jobs.
  fetchFileDownloadUrl` (Task 1), `useJobPolling` (Task 2), `hasPermission` (Task 3),
  `StaffImportDialog` (Task 4).
- Produces: nothing later — this is the plan's last task.

- [ ] **Step 1: Write the failing Jest tests**

Replace the existing `jest.mock("@/services", ...)` block in
`apps/dashboard/src/app/(app)/staff/__tests__/staff-toolbar.test.tsx` with one that
adds `auth.fetchCurrentUser`, `staff.triggerStaffExport`, and a `jobs` domain, and add
a `sonner` mock right after it (this file has never needed one before — its own
"Add Member" flow shows no toasts — but the new export path's failure/timeout/error
states surface ONLY as a toast, same reasoning as Task 4's dialog tests):

```ts
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    dashboard: {
      fetchStaffPage: jest.fn(),
      fetchStaffTypeCount: jest.fn(),
      fetchCampuses: jest.fn().mockResolvedValue([]),
      fetchDepartments: jest.fn().mockResolvedValue([]),
      fetchDesignations: jest.fn().mockResolvedValue([]),
      fetchStaffDirectory: jest.fn().mockResolvedValue([]),
    },
    staff: { triggerStaffExport: jest.fn() },
    jobs: { fetchJob: jest.fn(), fetchFileDownloadUrl: jest.fn() },
  },
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));
```

Add `import { toast } from "sonner";` to the test file's own imports, and add the new
mocked-function consts near the existing ones, plus a complete `PERMITTED_USER`
fixture (every field `AuthenticatedUser` — `packages/types/src/auth.ts` — actually
requires; a partial object would fail `tsc`, not just be a weaker test) used as the
default so every *existing* test keeps passing unchanged (the permission gate is new;
those tests aren't about it):

```ts
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockTriggerStaffExport = Services.staff.triggerStaffExport as jest.MockedFunction<
  typeof Services.staff.triggerStaffExport
>;
const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;
const mockFetchFileDownloadUrl = Services.jobs.fetchFileDownloadUrl as jest.MockedFunction<
  typeof Services.jobs.fetchFileDownloadUrl
>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

const PERMITTED_USER = {
  id: "user-1",
  email: "hr@example.com",
  phone: null,
  full_name: "HR Staff",
  avatar_url: null,
  locale: "en",
  tenant_id: "tenant-1",
  roles: [],
  permissions: ["staff.staff.view", "staff.staff.export", "staff.staff.import"],
};
```

In the existing `beforeEach`, add resets for the new mocks, and default
`mockFetchCurrentUser` to resolve `PERMITTED_USER`:

```ts
    mockFetchCurrentUser.mockReset().mockResolvedValue(PERMITTED_USER);
    mockTriggerStaffExport.mockReset();
    mockFetchJob.mockReset();
    mockFetchFileDownloadUrl.mockReset();
    mockToastError.mockReset();
```

Add a small helper right below the fixture — every new test below awaits it before
clicking, since the button renders `disabled` until `currentUser` resolves, and
`user-event` silently skips a click on a disabled element rather than failing loudly:

```ts
async function exportButtonEnabled() {
  const button = await screen.findByRole("button", { name: "Export CSV" });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  return button;
}
```

Add these tests at the end of the `describe("StaffToolbar", ...)` block:

```ts
  it('"Export CSV" downloads the file once the export job succeeds', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockTriggerStaffExport.mockResolvedValue({ jobId: "job-export-1" });
    mockFetchJob.mockResolvedValue({
      id: "job-export-1",
      job_type: "export.staff",
      status: "succeeded",
      progress: 100,
      result: { result_file_id: "file-1" },
      error: null,
    });
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/staff-export.csv");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    await user.click(await exportButtonEnabled());

    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("file-1");
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });

    clickSpy.mockRestore();
  });

  it('"Export CSV" shows an error toast and re-enables when the download URL fetch fails', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockTriggerStaffExport.mockResolvedValue({ jobId: "job-export-2" });
    mockFetchJob.mockResolvedValue({
      id: "job-export-2",
      job_type: "export.staff",
      status: "succeeded",
      progress: 100,
      result: { result_file_id: "file-2" },
      error: null,
    });
    mockFetchFileDownloadUrl.mockRejectedValue(new Error("storage unavailable"));

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    await user.click(await exportButtonEnabled());

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("The export file could not be downloaded.");
    });
    expect(await screen.findByRole("button", { name: "Export CSV" })).not.toBeDisabled();
  });

  it('"Export CSV" shows an error toast when the trigger itself fails', async () => {
    const { ApiError } = jest.requireActual<{ ApiError: new (init: unknown) => Error }>(
      "@schoolhub/api-client",
    );
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockTriggerStaffExport.mockRejectedValue(
      new ApiError({
        code: "permission_denied",
        message: "You don't have permission to do that.",
        status: 403,
        url: "/staff-exports",
      }),
    );

    renderWithProviders(<StaffToolbar />);
    const user = userEvent.setup();
    await user.click(await exportButtonEnabled());

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("You do not have permission to do that.");
    });
  });

  it("disables both Export CSV and Import CSV for a role without staff.staff.export/.import", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);
    mockFetchCurrentUser.mockResolvedValue({
      id: "user-2",
      email: "admin@example.com",
      phone: null,
      full_name: "School Admin",
      avatar_url: null,
      locale: "en",
      tenant_id: "tenant-1",
      roles: [],
      // school_admin: RECORD_MANAGERS, not STAFF_IO — sees everything else on this
      // screen but not these two.
      permissions: ["staff.staff.view", "staff.staff.create", "staff.staff.update"],
    });

    renderWithProviders(<StaffToolbar />);

    await waitFor(() => {
      expect(mockFetchCurrentUser).toHaveBeenCalled();
    });
    expect(await screen.findByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
  });
```

Note: `errors.permission_denied` in `messages/en.json` is verbatim "You do not have
permission to do that." (verified directly against the file, not guessed) — the test
above matches it exactly.

- [ ] **Step 2: Confirm the tests fail by construction (do not run them)**

There is no button named "Export CSV" yet — the current button is named "Import CSV"
and is permanently disabled with no permission check at all — and
`Services.auth`/`Services.staff`/`Services.jobs` aren't read by the component yet.

- [ ] **Step 3: Implement the toolbar changes**

In `apps/dashboard/src/app/(app)/staff/staff-toolbar.tsx`, change the imports to:

```tsx
"use client";

import { useEffect, useState } from "react";
import { GraduationCap, UserPlus, Users, type IdCard } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { m } from "motion/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@schoolhub/ui";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { StaffFormDialog } from "@/app/(app)/staff/staff-form-dialog";
import { StaffImportDialog } from "@/app/(app)/staff/staff-import-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useJobPolling } from "@/hooks/use-job-polling";
import { hasPermission } from "@/lib/permissions";
import { ApiError, Services } from "@/services";
import type { ExportJobResult } from "@/services/modules/jobs/jobs-service";
```

Keep `formatCount`/`AnimatedStat`/`StatChip` unchanged. Replace the body of
`StaffToolbar` (everything from `export function StaffToolbar()` onward) with:

```tsx
export function StaffToolbar() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const tErrors = useTranslations("errors");

  const { data: allStaffPage, isPending: isAllMembersPending } = useQuery({
    queryKey: ["staff", "toolbar", "all-members-count"],
    queryFn: () => Services.dashboard.fetchStaffPage({ pageSize: 1 }),
  });
  const { data: teachingStaffCount, isPending: isTeachingStaffPending } = useQuery({
    queryKey: ["staff", "toolbar", "teaching-staff-count"],
    queryFn: () => Services.dashboard.fetchStaffTypeCount("teaching"),
  });
  // Same cache entry `sidebar-menu.tsx`'s own permission check already populates
  // (Task 3's `queryKeys.currentUser()`, not a second inline literal) — this never
  // issues a second request.
  const { data: currentUser } = useCurrentUser();

  const allMembers = isAllMembersPending ? null : (allStaffPage?.pagination?.total_count ?? null);
  const teachingStaff = isTeachingStaffPending ? null : (teachingStaffCount ?? null);

  const canExport = hasPermission(currentUser, "staff.staff.export");
  const canImport = hasPermission(currentUser, "staff.staff.import");

  const exportTrigger = useMutation({
    mutationFn: () => Services.staff.triggerStaffExport(),
    onSuccess: (result) => {
      setExportJobId(result.jobId);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? tErrors.has(error.code)
            ? tErrors(error.code)
            : error.message
          : "The export could not be started.";
      toast.error(message);
    },
  });

  const {
    job: exportJob,
    isPolling: isExportPolling,
    isTimedOut: isExportTimedOut,
    isError: isExportError,
  } = useJobPolling("staff", exportJobId);

  // A `useMutation` for the download step itself (not a raw promise chain in the
  // effect below) so `isDownloadPending` is available to keep the button disabled for
  // the whole "job succeeded, now fetching the actual URL" gap — without it, the
  // button re-enables the instant the job reaches "succeeded" (isPolling already
  // reads false by then), and a double-click there would start a second, redundant
  // export while the first one's download is still being fetched.
  //
  // Destructured (not kept as `downloadTrigger.mutate`) specifically so `mutate` can
  // be named directly in the effect's own dependency array below: TanStack Query
  // wraps `mutate` in its own `useCallback` bound to the mutation observer
  // (`@tanstack/react-query`'s `useMutation.js`), so — unlike the mutation's own
  // result object, which IS a fresh object every render — this specific function
  // reference is stable across re-renders of this component instance. That is what
  // lets the effect list its real dependencies in full and satisfy
  // `react-hooks/exhaustive-deps` with no disable comment, unlike `exit-staff-
  // dialog.tsx`'s own (real, but avoidable) precedent for the same rule.
  const { mutate: downloadExportFile, isPending: isDownloadPending } = useMutation({
    mutationFn: (fileId: string) => Services.jobs.fetchFileDownloadUrl(fileId),
    onSuccess: (url) => {
      const link = document.createElement("a");
      link.href = url;
      link.download = "staff-export.csv";
      link.click();
      toast.success("Staff list exported");
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "The export file could not be downloaded.",
      );
    },
  });

  // `exportJob`'s reference changes on every poll while running, so this re-runs each
  // tick, but is a no-op until the job actually reaches `succeeded`/`failed`, and a
  // no-op again after that (the reference stays stable once `refetchInterval` stops),
  // so `downloadExportFile` fires exactly once per terminal job. No
  // `setExportJobId(null)` anywhere in this component: a fresh "Export CSV" click
  // already overwrites it via `onSuccess` above, and `isExportPolling` already reads
  // `false` once the job hook reports terminal/timed-out/errored — nothing is left to
  // reset by hand.
  useEffect(() => {
    if (exportJob?.status === "succeeded") {
      const resultFileId = (exportJob.result as ExportJobResult | null)?.result_file_id;
      if (resultFileId) {
        downloadExportFile(resultFileId);
      }
    }
    if (exportJob?.status === "failed") {
      toast.error(exportJob.error ?? "The export failed.");
    }
  }, [exportJob, downloadExportFile]);

  useEffect(() => {
    if (isExportTimedOut) {
      toast.error("The export is taking longer than expected. Try again in a moment.");
    }
  }, [isExportTimedOut]);

  useEffect(() => {
    if (isExportError) {
      toast.error("The export failed.");
    }
  }, [isExportError]);

  return (
    <Toolbar>
      <ToolbarHeading
        inline
        description={
          <div className="flex w-fit shrink-0 flex-nowrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-2.5 py-1">
            <StatChip icon={Users} value={formatCount(allMembers)} label="All Members" />
            <div className="h-4 w-px bg-border" aria-hidden="true" />
            <StatChip
              icon={GraduationCap}
              value={formatCount(teachingStaff)}
              label="Teaching Staff"
            />
          </div>
        }
      />
      <ToolbarActions>
        <span title={canExport ? undefined : "You don't have permission to export staff."}>
          <Button
            variant="outline"
            disabled={!canExport || exportTrigger.isPending || isExportPolling || isDownloadPending}
            onClick={() => {
              exportTrigger.mutate();
            }}
          >
            {exportTrigger.isPending || isExportPolling || isDownloadPending
              ? "Exporting…"
              : "Export CSV"}
          </Button>
        </span>
        <span title={canImport ? undefined : "You don't have permission to import staff."}>
          <Button
            variant="outline"
            disabled={!canImport}
            onClick={() => {
              setImportDialogOpen(true);
            }}
          >
            Import CSV
          </Button>
        </span>
        <Button
          variant="primary"
          className="transition-transform duration-200 hover:scale-[1.03] active:scale-[0.97]"
          onClick={() => {
            setAddDialogOpen(true);
          }}
        >
          <UserPlus className="transition-transform duration-200 group-hover:scale-125" />
          Add Member
        </Button>
      </ToolbarActions>
      <StaffFormDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} mode="create" />
      <StaffImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />
    </Toolbar>
  );
}
```

Note (do not run locally): CI's `Test (coverage)` job confirms all existing tests
(now resolving `PERMITTED_USER` by default) plus the 4 new ones from Step 1.

- [ ] **Step 4: Add e2e coverage**

Create `e2e/src/mocks/domains/jobs.ts`:

```ts
import { fail, ok } from "../envelope";
import type { MockModule } from "../router";

export interface JobStub {
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: number;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

export interface FileDownloadStub {
  id: string;
  downloadUrl: string;
}

export interface JobsOptions {
  /** Each job's poll sequence — one entry consumed per `GET /jobs/{id}`, the last
   * entry repeating once exhausted, so a spec can simulate "queued, then running,
   * then succeeded" with exactly the polls it wants to assert on. */
  jobs?: Record<string, JobStub[]>;
  files?: FileDownloadStub[];
}

function toJobRecord(id: string, stub: JobStub) {
  return {
    id,
    job_type: "test.job",
    status: stub.status,
    progress: stub.progress ?? 0,
    result: stub.result ?? null,
    error: stub.error ?? null,
  };
}

/** `GET /jobs/{id}` and `POST /files/{id}:download` — core platform infra
 * (`core.jobs`, `core.files`), reusable by any module's background-job flow. Mirrors
 * `staffModule`'s shape. */
export function jobsModule(options: JobsOptions = {}): MockModule {
  return (api) => {
    const jobs = options.jobs ?? {};
    const files = options.files ?? [];
    const pollCounts: Record<string, number> = {};

    api.get("/jobs/:jobId", (request) => {
      const jobId = request.params["jobId"] ?? "";
      const sequence = jobs[jobId];
      if (!sequence || sequence.length === 0) return fail(404, "Job not found.");
      const index = pollCounts[jobId] ?? 0;
      const stub = sequence[Math.min(index, sequence.length - 1)] as JobStub;
      pollCounts[jobId] = index + 1;
      return ok(toJobRecord(jobId, stub));
    });

    // `POST /files/{id}:download` is a colon-action — same split as
    // staffModule's `/staff/{id}:exit` handling. `action` genuinely can only be
    // "download" here — `:confirm` is a different, unrelated route registered by a
    // future files-domain module, not this one, and 404s correctly falling through
    // this handler if it's ever hit is the point.
    api.post("/files/:fileAction", (request) => {
      const [fileId, action] = (request.params["fileAction"] ?? "").split(":");
      const file = files.find((candidate) => candidate.id === fileId);
      if (action !== "download" || !file) return fail(404, "Not found.");
      return ok({ download_url: file.downloadUrl });
    });
  };
}
```

Add `export * from "./domains/jobs";` to `e2e/src/mocks/index.ts`.

In `e2e/src/mocks/domains/staff.ts`, export two fixed ids near the top (after the
imports) and register the two trigger routes inside `staffModule`, right after the
`/staff/:staffAction` handler and before `api.get("/designations", ...)`:

```ts
export const STAFF_EXPORT_JOB_ID = "job-staff-export";
export const STAFF_IMPORT_JOB_ID = "job-staff-import";
```

```ts
    api.post("/staff-exports", () =>
      ok({ job_id: STAFF_EXPORT_JOB_ID, status: "queued" }, { status: 202 }),
    );
    api.post("/staff-imports", () =>
      ok({ job_id: STAFF_IMPORT_JOB_ID, status: "queued" }, { status: 202 }),
    );
```

In `e2e/src/pages/dashboard/staff.page.ts`, add:

```ts
  get exportCsvButton(): Locator {
    return this.page.getByRole("button", { name: "Export CSV" });
  }

  get importCsvButton(): Locator {
    return this.page.getByRole("button", { name: "Import CSV" });
  }

  get importDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Import staff" });
  }

  get importFileInput(): Locator {
    return this.importDialog.getByLabel("File");
  }

  get importSubmit(): Locator {
    return this.importDialog.getByRole("button", { name: "Upload" });
  }
```

In `e2e/tests/dashboard/staff.spec.ts`, add `jobsModule, STAFF_EXPORT_JOB_ID,
STAFF_IMPORT_JOB_ID` to the file's existing `@/mocks` import, and add a new import:

```ts
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
```

Add, inside the existing `test.describe("staff directory", ...)` block, after its
existing tests, a NESTED `test.describe` that overrides `authUser` for just these two
golden-path tests — the outer describe's default `signedIn` user is `buildUser()`
(`SCHOOL_ADMIN_PERMISSIONS`), which does not hold `staff.staff.export`/`.import`, so
both buttons render disabled and a plain `.click()` would hang waiting for an
element `user-event`/Playwright's own actionability checks never consider ready:

```ts
  test.describe("with export/import permission", () => {
    test.use({
      authUser: buildUser({
        permissions: [...SCHOOL_ADMIN_PERMISSIONS, "staff.staff.export", "staff.staff.import"],
      }),
    });

  test("Export CSV downloads the staff list once the export job succeeds", async ({
    page,
    mockApi,
    staffPage,
  }) => {
    mockApi.use(
      jobsModule({
        jobs: {
          [STAFF_EXPORT_JOB_ID]: [
            { status: "running", progress: 0 },
            { status: "succeeded", progress: 100, result: { result_file_id: "file-export-1" } },
          ],
        },
        // An opaque, storage-key-shaped name — deliberately NOT "staff-export.csv":
        // `ResponseContentDisposition` is deferred (docs/deferred-work.md), so the
        // real suggested filename is whatever the storage key is, not a friendly
        // name. This test asserts a download happens, not what it's named.
        files: [
          {
            id: "file-export-1",
            downloadUrl: "https://storage.e2e.test/objects/8f3c2e10-export.bin",
          },
        ],
      }),
    );
    await page.route("https://storage.e2e.test/objects/8f3c2e10-export.bin", (route) =>
      route.fulfill({ status: 200, contentType: "text/csv", body: "employee_number\n" }),
    );

    const downloadPromise = page.waitForEvent("download");
    await staffPage.exportCsvButton.click();
    const download = await downloadPromise;

    expect(download.url()).toBe("https://storage.e2e.test/objects/8f3c2e10-export.bin");
  });

  test("Import CSV shows the per-row result once the import job succeeds", async ({
    mockApi,
    staffPage,
  }) => {
    mockApi.use(
      jobsModule({
        jobs: {
          [STAFF_IMPORT_JOB_ID]: [
            {
              status: "succeeded",
              progress: 100,
              result: {
                total: 2,
                succeeded: 1,
                failed: 1,
                errors: [{ row: 2, field: "campus_code", issue: "Unknown campus code 'ZZZ'." }],
              },
            },
          ],
        },
      }),
    );

    await staffPage.importCsvButton.click();
    await staffPage.importFileInput.setInputFiles({
      name: "staff.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("first_name,last_name,campus_code\nA,B,ZZZ\nC,D,MAIN"),
    });
    await staffPage.importSubmit.click();

    await expect(
      staffPage.importDialog.getByText("Unknown campus code 'ZZZ'."),
    ).toBeVisible();
  });
  }); // end test.describe("with export/import permission", ...)

  test("a school_admin (RECORD_MANAGERS, not STAFF_IO) sees Export CSV and Import CSV disabled", async ({
    staffPage,
  }) => {
    // Back in the OUTER describe, so `signedIn`'s default `authUser` — `buildUser()`,
    // `SCHOOL_ADMIN_PERMISSIONS` (`e2e/src/data/factories.ts`) — applies unmodified.
    // No extra setup needed; this proves the real default, not a contrived one.
    await expect(staffPage.exportCsvButton).toBeDisabled();
    await expect(staffPage.importCsvButton).toBeDisabled();
  });
```

Note (do not run locally — root `AGENTS.md`, and this includes Playwright): CI's
`E2E (Playwright)` job confirms these three specs pass.

- [ ] **Step 5: Update docs**

Add one paragraph to `docs/project-status.md`, in the same section the
`feat/staff-ui-polish` follow-up paragraph (PR #90) was added to, noting: `/staff`'s
"Export CSV" and "Import CSV" toolbar buttons are now wired to the real
`POST /staff-exports`/`POST /staff-imports` background jobs (job-polling via a new
shared `useJobPolling` hook, a new `Services.staff` module, and a new per-action
`hasPermission` gate; no backend changes — all three endpoints already existed).

Add one bullet to `docs/deferred-work.md`'s "Deliberately NOT done" list:

```markdown
- **Staff (and student) CSV export downloads have no `Content-Disposition` override.**
  `POST /files/{id}:download` (`core.files`) returns a bare presigned object-storage
  URL with no `ResponseContentDisposition`, so the browser names the downloaded file
  after its storage key rather than something like `staff-export.csv`, and some
  browsers may preview a CSV inline instead of downloading it. Fix: add
  `ResponseContentDisposition` to `core/files/storage.py`'s presigner (next to its
  existing `ResponseCacheControl`), scoped to export-purpose files — a backend change
  to shared platform infra, deliberately kept out of the frontend-only PR that wired up
  `/staff`'s Export/Import buttons.
```

Add two rows to `apps/dashboard/AGENTS.md`'s "How This App Is Wired" table (so the
next contributor who needs either finds it here instead of rediscovering it):

```markdown
| Background-job polling (`202 + job`, e.g. bulk import/export) | `src/hooks/use-job-polling.ts` |
| Per-action permission check (beyond `canAccessModule`'s whole-module gate) | `hasPermission` in `src/lib/permissions.ts` |
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(app\)/staff/staff-toolbar.tsx \
        apps/dashboard/src/app/\(app\)/staff/__tests__/staff-toolbar.test.tsx \
        e2e/src/mocks/domains/jobs.ts \
        e2e/src/mocks/domains/staff.ts \
        e2e/src/mocks/index.ts \
        e2e/src/pages/dashboard/staff.page.ts \
        e2e/tests/dashboard/staff.spec.ts \
        docs/project-status.md \
        docs/deferred-work.md \
        apps/dashboard/AGENTS.md
git commit -m "feat(dashboard): wire the staff toolbar's Export/Import CSV buttons to the real jobs, permission-gated"
```

---

## Independent review (round 1)

**Verdict:** REVISE

- **Reviewer:** plan-reviewer agent, 2026-09-27
- **Summary:** The approach is right: polling `GET /jobs/{id}` through `Services` and TanStack Query, a dialog, and mocked e2e. But the plan can't be executed as written.
- **Critical:** (1) The hook reads only `data`, and identical polls don't re-render, so `isTimedOut` never shows and a stuck job spins forever (Review Focus #1's test fails). (2) `isTimedOut` uses the previous job's start time during render, so any job started more than 2 minutes after page load or after the last job times out immediately. Fix: a per-job `setTimeout` that sets state, plus `skipToken`.
- **High:**
  - react-hooks `refs` / `purity` / `set-state-in-effect`, inline query keys and JSX literals all fail lint, which pre-commit enforces.
  - `DialogContent` is missing its required `closeLabel` (typecheck fails).
  - All strings are hardcoded, though `staff.import.*` already exists in en.json and ur.json.
  - Review Focus tests #2, #3 and #5 either fail or can't fail.
  - Import/export are `STAFF_IO`-only (hr_staff, it_admin), so school_admin sees buttons that always 403; add a permission gate or get the user's OK.
  - Review Focus #3's premise is wrong: bad files come back as `failed` jobs carrying raw exception text.
- **Medium:**
  - Staff calls should go in `services/modules/staff/` and the download-URL call in `Services.files` (ADR-0011).
  - Reuse or reference the deleted `use-job-polling.ts` and staff `import-wizard.tsx`.
  - Handle errors from the poll request itself.
  - Two new `exhaustive-deps` disables need an ADR or the user's OK.
  - Add the required "Alternatives considered (why not)" section.
  - The cross-origin `download` attribute is ignored, and the e2e filename assertion is shaped to pass.
  - Tell users which import columns are required.
  - Test the untested branches.
- **Low:** Reorder Tasks 4 and 5 so the stub isn't needed; make Task 2's test code final; plus the small fixes listed in the table.
- **Findings addressed:** to be filled by the author.
- **Unresolved:** (a) The user must decide between a permission gate for export/import and explicitly accepting always-403 buttons for school_admin. (b) The user must decide whether to lift "no backend changes" to add `ResponseContentDisposition` to the presigner, or defer it in `docs/deferred-work.md`. (c) The user must OK the `exhaustive-deps` disables or ask for the mutation-loop design. (d) Re-run plan-reviewer after revision, because the hook and dialog code change substantially.

## Independent review (round 2)

**Verdict:** REVISE

- **Reviewer:** plan-reviewer agent, 2026-09-27 (second pass)
- **Summary:** The approach is sound. Both prior Criticals are fixed: the timeout now triggers a real re-render, and a new job gets a fresh 120 s budget. The `school_admin` UI gap is closed. The ADR-0011 staff module and the wizard port (including the corrected optional-columns list) are verified. But the rewrite adds a new Critical and several certain CI failures.
- **Findings to address:**
  1. **Critical:** the timeout is reported after the job succeeds. The timer is never cleared once the job finishes and `exportJobId` is never reset, so a false "taking longer" toast appears about 120 s after every export. Fix: gate the reported `isTimedOut` on "not finished and not errored", and add a 120 s-after-success test.
  2. **High, lint:** the inline `["dashboard","current-user"]` key pushes staff-toolbar's frozen count from 2 to 3. Extract `useCurrentUser()` backed by a `queryKeys` entry.
  3. **High, tsc:** `hasPermission(key: string)` fails against `PermissionKey[]`; use `key: PermissionKey`. The toolbar test user fixtures are also missing required `AuthenticatedUser` fields.
  4. **High, Jest:** `services/__tests__/index.test.ts:33` asserts the exact set of `Services` keys. Update it in Tasks 1 and 3.
  5. **High, dialog tests:** three of six fail.
     - Duplicate `campus_code` text: scope the query to the table.
     - No Toaster, wrong code, and the message gets mapped: mock `sonner`; use `domain_rule_violation` with details.
     - `rerender` drops the providers, and the test couldn't fail anyway: use a local `wrapper` plus fake timers.
     - The expected count is wrong: 6 tests, not 7.
  6. **High, e2e:** the golden paths run as the default `school_admin`, so the buttons are disabled. Override `authUser` with the export/import keys.
  7. **High, process:** remove every "Run: `npx jest`" step (ADR-0007).
  8. **High, i18n:** new toolbar strings and toasts must go through `staff.*` messages (ADR-0014: "New code can't add more"). Use `closeLabel={t("import.close")}`.
  9. **High, suppressor:** replace the toolbar's `eslint-disable` with a destructured, stable `mutate` in the deps (TanStack no-unstable-deps docs).
  10. **Medium:**
      - Show the over-size file error's field detail inline, not the generic "That action isn't allowed right now."
      - Set `refetchIntervalInBackground: true`.
      - Wait for current-user before clicking or asserting in the toolbar tests.
      - Assert the Review Focus #2/#3 error toasts.
      - Port `<Can>` or update the AGENTS.md wiring table.
      - Move the new paths to `endpoints.staff` and `fetchFileDownloadUrl` to `Services.files`.
      - Derive job types from `ApiSchemas["BackgroundJob"]`.
      - Name an ADR, or say why none is needed.
  11. **Low:**
      - Create the hook test's QueryClient once, outside the wrapper.
      - Accessibility: the tooltip `title`, the Progress name, `DialogDescription`.
      - Doc fixes: module doc §16 `/staff-exports`, the StaffPage comment, the "Export was disabled" wording, `platform.file.view`.
      - Job key namespace; the `/files` catch-all mock.
- **Findings addressed:** every Critical/High item above is fixed in the tasks as written in this file; Medium/Low items are closed out in the "Rulings" section above (a plain `hasPermission` helper over `<Can>`, hand-written types over generated ones, `endpoints.dashboard` namespacing kept, no new ADR, `title` over `aria-describedby`) or fixed directly (`refetchIntervalInBackground`, the Review Focus #2/#3 toast assertions, the `useCurrentUser`/`queryKeys.currentUser()` extraction, the destructured stable `mutate`, the corrected e2e permission override and download-filename assertion).
- **Unresolved:** none — both open questions from round 1 (the `eslint-disable` and the permission-gate approach) were resolved during the round-2 revision: the destructured-`mutate` fix removed the disable entirely, and `hasPermission` was kept over `<Can>` per the Rulings section's own reasoning.
