# Staff photo URLs — design

**Date:** 2026-09-24 · **Status:** approved in chat, awaiting spec review · **Scope:** `apps/api`
(`core/files`, `staff_management`), `apps/dashboard` (`/staff`), `e2e`

## Problem

A staff member's uploaded photo never appears in the dashboard. The `/staff` directory and the
edit dialog show initials even after a successful upload, because the staff API returns only
`photo_file_id` — a bare id — and nothing turns that id into an image the browser can load.

The only existing path is `GET /files/{id}:download`, which returns one signed link per call.
Using it from the list would mean one extra request per row (N+1 from the browser), and the
dashboard could not use a plain API URL as an `<img src>` anyway: its access token lives in
memory, not in a cookie, so an image request cannot authenticate itself.

## Goals

- The directory's Member cell and the edit dialog show the staff member's real photo.
- Initials remain the fallback whenever there is no photo or it fails to load — never a
  broken-image icon.
- No extra HTTP request per row and no extra database query per row.
- Photos stay private: only a signed-in user who may already see that staff record can see
  the photo, and a leaked link stops working.
- Built once in `core/files`, so students and guardians (which have the same `photo_file_id`
  gap) can adopt it with one line each.

## Non-goals

- Wiring students or guardians in this change — only the reusable piece they will use.
- Public photos (for example on the school website next to a public bio). That would be a
  deliberate, separate opt-in using `File.visibility = public`, not a side effect of this.
- A CDN or signed cookies. Worth revisiting only if image traffic becomes heavy.
- URLs that stay identical across requests for better browser caching; not practical to do
  reliably with boto3's signer today.

## Decisions

**Visibility: private.** Decided with the product owner: signed-in users only, via time-limited
signed links.

**Approach: embed a signed link in the API response.** Alternatives considered and rejected:

| Option | Why not |
| --- | --- |
| Stable endpoint per image that redirects to a fresh signed link | `<img>` cannot send the in-memory bearer token, so it needs cookie auth or a token in the URL anyway — and it costs one API request per image per page view, which moves the N+1 into the browser. |
| Batch "links for these ids" endpoint | Every list render needs a second round trip plus client-side joining and caching, with no security gain over embedding. |

Embedding costs almost nothing, measured in the running API container:

| Operation | Time |
| --- | --- |
| Build a signer (boto3 client), cold | 443 ms |
| Build a signer, warm (what `get_presigner()` does on every call today) | ≈ 6 ms |
| Sign 100 links on one signer | 10.8 ms total (≈ 0.1 ms each) |

Signing is a local HMAC calculation with no network call. The expensive part is building the
client, which is why the signer becomes a shared, per-process instance (below).

## Design

### `core/files` — reusable infrastructure

1. **Shared signer.** `get_presigner()` returns one cached instance per process instead of
   constructing boto3 clients on every call (boto3 clients are safe to share across threads
   once built). The cache is cleared on Django's `setting_changed` signal for `S3_*` and
   `AWS_*` settings, so tests using `override_settings` still get a signer built from their
   settings.
2. **Signature version 4.** The S3 client config pins `signature_version="s3v4"`. Links are
   currently produced in the legacy V2 format, which AWS S3 buckets created since 2020 reject;
   MinIO accepts both. The internal-endpoint / public-endpoint split from the storage-URL fix
   (`S3_PUBLIC_ENDPOINT_URL`) stays: the API talks to storage on the internal host, links are
   signed for the host the browser reaches.
3. **`presign_download` options.** It accepts an optional expiry and an optional
   `Cache-Control` value, passed to S3 as `ResponseCacheControl` so storage sends it back as
   a response header. Defaults are unchanged, so `GET /files/{id}:download` keeps its current
   5-minute links. The `Presigner` protocol and `NullPresigner` take the same keyword
   arguments.
4. **`get_display_url(file) -> str | None`** (new, `core/files/services.py`, beside
   `get_download_url`). Returns `None` unless the file's
   status is `ready` and it is not soft-deleted, so pending, quarantined and deleted uploads
   never get a link (`select_related` still joins a soft-deleted row, so this check cannot be
   left to the manager). Otherwise returns a
   GET link valid for `FILE_DISPLAY_URL_TTL_SECONDS` (new setting, default 3600), with
   `Cache-Control: private, max-age=<ttl>`.
5. **`SignedFileURLField`** (new, `core/files/serializers.py`). A read-only DRF field whose
   `source` is a file foreign key. It emits `get_display_url(...)` for the related file, or
   `null` when there is none. drf-spectacular documents it as a nullable URI.

### Staff API

6. `StaffSerializer` gains `photo_url = SignedFileURLField(source="photo_file")`, read-only.
   `photo_file_id` stays the writable input — the same pairing as `campus_id`/`campus_name`.
7. `StaffViewSet.get_queryset` adds `photo_file` to its existing `select_related(...)`, so a
   page is still a single query whatever its size.
8. Regenerate `apps/api/openapi.yaml` (`apps/api/scripts/generate-openapi.sh`) and
   `packages/api-client/src/schema.d.ts` (`pnpm --filter @schoolhub/api-client generate`); CI's
   "OpenAPI schema is current" job requires both.

**Link lifetime.** One hour, because a link only ever reaches someone already authorised to
see that record, and it comfortably outlives the dashboard's query cache (30 s stale time,
5 min garbage-collection time), so a normal session never renders an expired link.

### Dashboard

9. `StaffDirectoryRecord` and `StaffDetailRecord`
   (`apps/dashboard/src/services/modules/dashboard/dashboard-service.ts`) gain
   `photo_url: string | null`.
10. **Directory table** (`staff-directory-table.tsx`). The Member cell adds
    `<AvatarImage src={photoUrl} alt="" />` ahead of the existing initials `AvatarFallback`.
    Radix renders the `<img>` only once the image has loaded and shows the initials while
    loading and on any error. `alt=""` because the name is rendered right beside it, so screen
    readers do not read it twice.
11. **Edit dialog** (`staff-form-dialog.tsx`). The current-photo preview uses `photo_url`,
    replacing the "Photo on file" text. A newly picked file's local preview still wins until
    save; the existing `["staff"]` invalidation then fetches the list again, with the new link.
12. Remove the comments in both files that say no photo URL exists.

### E2E mock

13. `buildStaff` (`e2e/src/mocks/domains/staff.ts`) defaults `photo_url` to `null`; specs
    override it where a photo matters.

## Failure modes

| Situation | Result |
| --- | --- |
| No photo, or upload pending / quarantined / soft-deleted | `photo_url: null` → initials |
| Link expired, object deleted, storage unreachable | Image load fails → initials; the next list fetch mints fresh links |
| Storage not configured (tests, CI) | Existing `NullPresigner` returns placeholder URLs, as today |
| Bad storage credentials | Signing is offline, so the API response is unaffected; images fall back to initials. Uploads already report it through `FileUploadError("put", …)`. |

## Security

- Links are created only inside the tenant-scoped, permission-checked `/staff` responses:
  `staff.staff.view`, `module.staff`, and the same own/assigned record scoping as the rest of
  the row.
- Row-level security on `files` (`core/files/migrations/0002_rls_policies.py`) filters the
  joined row, so no link can be minted for another tenant's file. Storage keys are tenant-prefixed and the bucket stays private.
- A link is a bearer capability for at most one hour; `Cache-Control: private` keeps shared
  caches (proxies, CDNs) from storing the image.
- Write paths are unchanged: `photo_file_id` is still validated by `_fk` and
  `assert_file_usable` (right purpose, upload confirmed).

## Testing

CI is the source of truth; nothing is run locally.

- **`core/files/tests/test_storage.py`** — links use SigV4 (`X-Amz-Algorithm=AWS4-HMAC-SHA256`)
  and the public host; display links carry the cache-control parameter; `get_presigner()`
  returns the same instance across calls and a new one after `override_settings`.
- **`core/files/tests`** — `get_display_url` returns a link for a `ready` file and `None` for
  `pending`, `quarantined` and soft-deleted ones.
- **`apps/staff_management/staff/tests/test_endpoints.py`** — list and retrieve return
  `photo_url` for a staff member with a ready photo and `null` without one; listing 1 and 5
  staff members with photos runs the same number of queries (compared with
  `CaptureQueriesContext`).
- **Jest** — `staff-directory-table.test.tsx`: initials without a photo; the photo once it
  loads (the test stubs image loading, since jsdom never fetches images).
  `staff-form-dialog.test.tsx`: edit mode shows the current photo.
- **E2E mocked lane** — `e2e/tests/dashboard/staff.spec.ts`: in real Chromium, a row whose
  `photo_url` points at a stubbed image route renders an actual `<img>`; a row without one
  shows initials.
- **Manual** — against the local compose stack: upload a photo, save, see it in the list; the
  link is SigV4 and served from `localhost:9000`.

## Delivery notes

- The implementing PR updates `docs/project-status.md` (staff photos now display), since it
  changes `apps/` behaviour.
- Which PR carries this — #76 or its own PR against `main` — is still to be decided. The
  storage-URL fix it builds on is not committed yet.
