# Staff Photo URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each staff member's real photo in the `/staff` directory and edit dialog, via a
time-limited signed link embedded in the staff API response.

**Architecture:** A reusable read-only DRF field (`SignedFileURLField`) in `core/files` turns a
file foreign key into a signed download link from a shared, per-process SigV4 signer. The staff
serializer exposes it as `photo_url`, the viewset joins the file row with `select_related`, and
the dashboard renders it with Radix `AvatarImage` over the existing initials fallback.

**Tech Stack:** Django 6.1 + DRF 3.18 + drf-spectacular, boto3/botocore 1.43, MinIO (dev) / S3
(prod); Next 16 + React 19, Radix Avatar (`radix-ui`), TanStack Query, Jest 30 + RTL,
Playwright 1.62.

**Spec:** [`docs/superpowers/specs/2026-09-24-staff-photo-urls-design.md`](../specs/2026-09-24-staff-photo-urls-design.md)

## Global Constraints

- Photos are private: links are only minted inside tenant-scoped, permission-checked responses.
- Display links: valid `FILE_DISPLAY_URL_TTL_SECONDS` (default `3600`), with
  `Cache-Control: private, max-age=<ttl>`.
- `GET /files/{id}:download` keeps its 5-minute (`300` s) links — defaults unchanged.
- Signing uses SigV4: `botocore.config.Config(signature_version="s3v4")`.
- `photo_url` is `null` unless the file is `ready` and not soft-deleted.
- **Never run tests, linters or type checkers locally** (repo `AGENTS.md` + the owner's rule):
  no `manage.py test`, `jest`, `eslint`, `tsc`, `ruff`, `cspell`, `playwright test`. CI on
  PR #76 is the source of truth. Every "verify" step below means: push, then read CI.
- Allowed locally: code generation (`apps/api/scripts/generate-openapi.sh`,
  `pnpm --filter @schoolhub/api-client generate`) and the formatter
  (`node_modules/.bin/prettier --write <files>`) — both rewrite files, neither checks them.
- Python: match surrounding style; `apps/api/pyproject.toml` sets `line-length = 100`.
- Commits land on `feat/dashboard-demo1-real-data` (PR #76). Subject style
  `type(scope): …`. **No `Co-Authored-By` trailer** (owner's rule overrides the harness).
- Known-red checks, already failing on `main`: `Test (coverage)` (dashboard below the 85% floor)
  and six pre-existing `E2E (Playwright)` failures. Everything else must be green, and the new
  E2E test must pass inside the E2E job.

## Review Focus

1. **A soft-deleted photo file** still joined by `select_related` → `photo_url: null`, never a
   link to a deleted photo. Pinned in Task 3 (`test_pending_quarantined_and_deleted_files_get_none`).
2. **Replacing the photo in the edit dialog** → the preview shows the newly picked image, not the
   saved one. Pinned in Task 5 (`shows the newly picked photo instead of the saved one`).
3. **A photo that fails to load** (expired link, deleted object) → initials, never a broken-image
   icon. Pinned in Task 5 (`falls back to initials when the photo fails to load`).
4. **A client that sends `photo_url` in a PATCH** → ignored without error; the photo is unchanged.
   Pinned in Task 4 (`test_photo_url_is_read_only`).
5. **Storage settings changing at runtime** (`override_settings`, env) → a fresh signer, never a
   cached one pointing at old endpoints or credentials. Pinned in Task 2
   (`test_a_storage_setting_change_rebuilds_it`).

## Files

| File | Change | Task |
| --- | --- | --- |
| `apps/api/config/settings/base.py` | `S3_PUBLIC_ENDPOINT_URL` (done), `FILE_DISPLAY_URL_TTL_SECONDS` | 1, 3 |
| `apps/api/core/files/storage.py` | endpoint split (done), shared signer, SigV4, download options | 1, 2 |
| `apps/api/core/files/tests/test_storage.py` | endpoint tests (done), signer + SigV4 tests | 1, 2 |
| `apps/api/core/files/services.py` | `get_display_url` | 3 |
| `apps/api/core/files/serializers.py` | `SignedFileURLField` | 3 |
| `apps/api/core/files/tests/test_display_url.py` | new | 3 |
| `apps/api/apps/staff_management/staff/serializers.py` | `photo_url` | 4 |
| `apps/api/apps/staff_management/staff/viewset.py` | `select_related("photo_file")` | 4 |
| `apps/api/apps/staff_management/staff/tests/test_endpoints.py` | `StaffPhotoUrlTests` | 4 |
| `apps/api/openapi.yaml`, `packages/api-client/src/schema.d.ts` | regenerated | 4 |
| `apps/dashboard/src/app/layout.tsx`, `packages/ui/src/components/sonner.tsx` | toast theme (done) | 1 |
| `apps/dashboard/src/services/modules/dashboard/dashboard-service.ts` | `photo_url` on both records | 5 |
| `apps/dashboard/src/app/(app)/staff/staff-directory-table.tsx` | photo in the Member cell | 5 |
| `apps/dashboard/src/app/(app)/staff/staff-form-dialog.tsx` | saved-photo preview | 5 |
| five dashboard test files (listed in Task 5) | `photo_url` on fixtures; new photo tests | 5 |
| `e2e/src/mocks/domains/staff.ts`, `e2e/src/pages/dashboard/staff.page.ts`, `e2e/tests/dashboard/staff.spec.ts` | photo mock, locator, test | 6 |
| `docs/project-status.md` | record the capability | 7 |

---

### Task 1: Land the verified groundwork

Two fixes already sit uncommitted in the working tree, verified by hand against the local stack
(upload presign → PUT → confirm `ready`; toast renders light under an OS dark preference). They
are prerequisites: Task 2 edits the same signer, and every later task shows toasts.

**Files:**
- Modify (already edited): `apps/api/config/settings/base.py`, `apps/api/core/files/storage.py`
- Create (already written): `apps/api/core/files/tests/test_storage.py`
- Modify (already edited): `apps/dashboard/src/app/layout.tsx`, `packages/ui/src/components/sonner.tsx`

**Interfaces:**
- Produces: `settings.S3_PUBLIC_ENDPOINT_URL`; `S3Presigner._build_client(endpoint_url)`,
  `S3Presigner._client` (internal host), `S3Presigner._signing_client` (public host).

- [ ] **Step 1: Confirm the tree holds exactly these five changes**

Run: `git status --short -- apps/api/core apps/api/config apps/dashboard packages`
Expected:
```
 M apps/api/config/settings/base.py
 M apps/api/core/files/storage.py
 M apps/dashboard/src/app/layout.tsx
 M packages/ui/src/components/sonner.tsx
?? apps/api/core/files/tests/test_storage.py
```
Read `git diff` for each; stop and ask if anything else appears.

- [ ] **Step 2: Commit the storage fix**

```bash
git add apps/api/config/settings/base.py apps/api/core/files/storage.py apps/api/core/files/tests/test_storage.py
git commit -m "fix(files): sign upload/download links for the host the browser reaches

S3_PUBLIC_ENDPOINT_URL was set in compose but never read, so links were signed
for minio:9000 — a name only the Docker network resolves — and every browser
PUT failed. Sign with a client for the public host; keep the internal one for
the API's own head/put calls."
```

- [ ] **Step 3: Commit the toast fix**

```bash
git add apps/dashboard/src/app/layout.tsx packages/ui/src/components/sonner.tsx
git commit -m "fix(dashboard): render toasts in the app's theme, not the OS's

<Toaster /> sat outside <ThemeProvider>, so useTheme() saw no provider and
sonner fell back to the OS colour scheme — black toasts over a light app. Move
it inside. Also mark the per-type text colours !important: sonner's runtime
stylesheet loads after Tailwind's and ties them on specificity."
```

- [ ] **Step 4: Push and read CI**

```bash
git push origin feat/dashboard-demo1-real-data
gh pr checks 76 --watch --interval 30
```
Expected: `api` → `test` passes (it runs `core/files/tests/test_storage.py`); no new failures
beyond the known-red checks.

---

### Task 2: Shared SigV4 signer with configurable download links

**Files:**
- Modify: `apps/api/core/files/storage.py` (imports; `Presigner.presign_download`;
  `NullPresigner.presign_download`; `S3Presigner._build_client`/`presign_download`;
  `get_presigner`)
- Test: `apps/api/core/files/tests/test_storage.py`

**Interfaces:**
- Consumes: Task 1's `S3Presigner` endpoint split.
- Produces:
  - `get_presigner() -> Presigner` — now returns one cached instance per process;
    `get_presigner.cache_clear()` resets it.
  - `presign_download(*, storage_key: str, expires_in: int = 300, cache_control: str | None = None) -> str`
    on the `Presigner` protocol, `NullPresigner` and `S3Presigner`.

- [ ] **Step 1: Write the tests** — append to `apps/api/core/files/tests/test_storage.py`

Change the imports at the top of the file to:

```python
from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from django.test import SimpleTestCase, override_settings

from core.files.storage import S3Presigner, get_presigner
```

Append:

```python
class S3PresignerSignatureTests(SimpleTestCase):
    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="http://localhost:9000")
    def test_links_are_signed_with_sigv4(self):
        url = S3Presigner().presign_download(storage_key="tenants/t/photo.png")

        query = parse_qs(urlsplit(url).query)
        # AWS S3 buckets created since 2020 reject the legacy V2 `Signature` parameter.
        self.assertEqual(query["X-Amz-Algorithm"], ["AWS4-HMAC-SHA256"])
        self.assertNotIn("Signature", query)

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_download_links_default_to_five_minutes(self):
        url = S3Presigner().presign_download(storage_key="tenants/t/photo.png")

        self.assertEqual(parse_qs(urlsplit(url).query)["X-Amz-Expires"], ["300"])

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_download_links_take_an_expiry_and_a_cache_control(self):
        url = S3Presigner().presign_download(
            storage_key="tenants/t/photo.png",
            expires_in=3600,
            cache_control="private, max-age=3600",
        )

        query = parse_qs(urlsplit(url).query)
        self.assertEqual(query["X-Amz-Expires"], ["3600"])
        self.assertEqual(query["response-cache-control"], ["private, max-age=3600"])


class GetPresignerTests(SimpleTestCase):
    def test_returns_one_shared_instance(self):
        # Building boto3 clients costs ~6 ms warm (443 ms cold); signing costs ~0.1 ms.
        self.assertIs(get_presigner(), get_presigner())

    def test_a_storage_setting_change_rebuilds_it(self):
        before = get_presigner()

        with override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL=""):
            during = get_presigner()
            self.assertIsInstance(during, S3Presigner)

        self.assertIsNot(during, before)
        self.assertIsNot(get_presigner(), during)
```

- [ ] **Step 2: Implement** — edit `apps/api/core/files/storage.py`

Imports (replace the existing `import datetime` … `from django.conf import settings` block):

```python
import datetime
import functools
import uuid
from dataclasses import dataclass
from typing import Protocol

from django.conf import settings
from django.core.signals import setting_changed
from django.dispatch import receiver
```

`Presigner` protocol — replace its `presign_download` line:

```python
    def presign_download(
        self,
        *,
        storage_key: str,
        expires_in: int = _DOWNLOAD_EXPIRY_SECONDS,
        cache_control: str | None = None,
    ) -> str: ...
```

`NullPresigner.presign_download` — replace:

```python
    def presign_download(
        self,
        *,
        storage_key: str,
        expires_in: int = _DOWNLOAD_EXPIRY_SECONDS,
        cache_control: str | None = None,
    ) -> str:
        return f"https://null-presigner.invalid/{storage_key}"
```

`S3Presigner._build_client` — replace its body:

```python
    @staticmethod
    def _build_client(endpoint_url: str):
        import boto3
        from botocore.config import Config

        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.S3_REGION_NAME,
            # AWS S3 buckets created since 2020 accept only SigV4; MinIO accepts both.
            config=Config(signature_version="s3v4"),
        )
```

`S3Presigner.presign_download` — replace:

```python
    def presign_download(
        self,
        *,
        storage_key: str,
        expires_in: int = _DOWNLOAD_EXPIRY_SECONDS,
        cache_control: str | None = None,
    ) -> str:
        params = {"Bucket": self._bucket, "Key": storage_key}
        if cache_control:
            # Storage echoes this back as the response's Cache-Control header.
            params["ResponseCacheControl"] = cache_control
        return self._signing_client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=expires_in
        )
```

`get_presigner` — replace the function at the bottom of the file:

```python
_STORAGE_SETTINGS = frozenset(
    {
        "S3_ENDPOINT_URL",
        "S3_PUBLIC_ENDPOINT_URL",
        "S3_BUCKET_NAME",
        "S3_REGION_NAME",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
    }
)


@functools.cache
def get_presigner() -> Presigner:
    """One per process: building boto3 clients costs far more than signing, and a built
    client is safe to share across threads."""
    if settings.S3_ENDPOINT_URL:
        return S3Presigner()
    return NullPresigner()


@receiver(setting_changed)
def _reset_presigner(*, setting: str, **kwargs: object) -> None:
    if setting in _STORAGE_SETTINGS:
        get_presigner.cache_clear()
```

- [ ] **Step 3: Verify against the local stack (manual, not a test run)**

SigV4 must still work with MinIO for uploads and downloads. Log in as the demo owner and run the
three-step upload by hand (the API container reloads itself from the mounted source):

```bash
S=$(mktemp -d); echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" | base64 -d > $S/p.png
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"identifier":"owner@demo.localhost","password":"demo12345"}' http://localhost:3000/api/auth/login | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['access_token'])")
R=$(curl -6 -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"original_name\":\"p.png\",\"mime_type\":\"image/png\",\"size_bytes\":$(stat -f%z $S/p.png),\"purpose\":\"staff.photo\"}" http://localhost:8000/api/v1/files)
ID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])"); URL=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['upload_url'])")
echo "$URL" | grep -o 'X-Amz-Algorithm=[^&]*'
curl -s -o /dev/null -w 'PUT %{http_code}\n' -X PUT -H 'Content-Type: image/png' -H 'Origin: http://localhost:3000' --data-binary @$S/p.png "$URL"
curl -6 -s -X POST -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/v1/files/${ID}:confirm" | python3 -c "import sys,json;print('confirm', json.load(sys.stdin)['data']['status'])"
```
Expected: `X-Amz-Algorithm=AWS4-HMAC-SHA256`, `PUT 200`, `confirm ready`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/core/files/storage.py apps/api/core/files/tests/test_storage.py
git commit -m "feat(files): share one SigV4 signer per process; configurable download links

get_presigner() built fresh boto3 clients on every call (~6 ms warm, 443 ms
cold) while a signature costs ~0.1 ms — per-row signing would pay that per row.
Cache it, reset on storage setting changes. Pin SigV4, which AWS S3 requires for
buckets created since 2020. presign_download takes an expiry and a Cache-Control
value; defaults unchanged."
```

- [ ] **Step 5: Push and read CI**

```bash
git push origin feat/dashboard-demo1-real-data && gh pr checks 76 --watch --interval 30
```
Expected: `api` → `test`, `lint`, `typecheck` pass. On a failure: `gh run view <id> --log-failed`.

---

### Task 3: Display links — `get_display_url` and `SignedFileURLField`

**Files:**
- Modify: `apps/api/config/settings/base.py` (after `AWS_SECRET_ACCESS_KEY`)
- Modify: `apps/api/core/files/services.py` (imports; new function after `get_download_url`)
- Modify: `apps/api/core/files/serializers.py` (imports; new class at the end)
- Create: `apps/api/core/files/tests/test_display_url.py`

**Interfaces:**
- Consumes: `get_presigner().presign_download(storage_key=..., expires_in=..., cache_control=...)` (Task 2).
- Produces:
  - `core.files.services.get_display_url(file: File) -> str | None`
  - `core.files.serializers.SignedFileURLField(source="<file fk>")` — read-only, nullable URI.
  - `settings.FILE_DISPLAY_URL_TTL_SECONDS: int` (default 3600).

- [ ] **Step 1: Write the tests** — create `apps/api/core/files/tests/test_display_url.py`

```python
"""Which files get an inline display link, and what that link carries."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import serializers

from apps.school_organization.tests.factories import TenantFactory
from core.files.models import FileStatus
from core.files.serializers import SignedFileURLField
from core.files.services import get_display_url
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context


class _PhotoHolder:
    """Anything with a file relation — stands in for Staff, Student, Guardian."""

    def __init__(self, photo_file):
        self.photo_file = photo_file


class _PhotoSerializer(serializers.Serializer):
    photo_url = SignedFileURLField(source="photo_file")


class DisplayUrlTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()

    def _file(self, **overrides):
        with tenant_context(self.tenant.id):
            return FileFactory(
                tenant=self.tenant, purpose="staff.photo", mime_type="image/png", **overrides
            )

    def test_a_ready_file_gets_a_link(self) -> None:
        file = self._file(status=FileStatus.READY)

        self.assertIn(file.storage_key, get_display_url(file))

    def test_pending_quarantined_and_deleted_files_get_none(self) -> None:
        # select_related still joins a soft-deleted row, so the service has to check.
        cases = {
            "pending": self._file(status=FileStatus.PENDING),
            "quarantined": self._file(status=FileStatus.QUARANTINED),
            "deleted": self._file(status=FileStatus.READY, deleted_at=timezone.now()),
        }
        for case, file in cases.items():
            with self.subTest(case):
                self.assertIsNone(get_display_url(file))

    def test_the_field_emits_the_link_or_null(self) -> None:
        file = self._file(status=FileStatus.READY)

        self.assertIn(file.storage_key, _PhotoSerializer(_PhotoHolder(file)).data["photo_url"])
        self.assertIsNone(_PhotoSerializer(_PhotoHolder(None)).data["photo_url"])

    @override_settings(
        S3_ENDPOINT_URL="http://minio:9000",
        S3_PUBLIC_ENDPOINT_URL="http://localhost:9000",
        S3_BUCKET_NAME="schoolhub-test",
        AWS_ACCESS_KEY_ID="test-access-key",
        AWS_SECRET_ACCESS_KEY="test-secret-key",
        FILE_DISPLAY_URL_TTL_SECONDS=3600,
    )
    def test_links_last_the_display_ttl_and_are_privately_cacheable(self) -> None:
        url = get_display_url(self._file(status=FileStatus.READY))

        query = parse_qs(urlsplit(url).query)
        self.assertEqual(query["X-Amz-Expires"], ["3600"])
        self.assertEqual(query["response-cache-control"], ["private, max-age=3600"])
```

- [ ] **Step 2: Add the setting** — `apps/api/config/settings/base.py`, after `AWS_SECRET_ACCESS_KEY = …`

```python
# How long an inline display link (e.g. a staff `photo_url`) stays valid. It only reaches
# someone already allowed to see the record, and must outlive the dashboard's query cache.
FILE_DISPLAY_URL_TTL_SECONDS = env.int("FILE_DISPLAY_URL_TTL_SECONDS", default=3600)
```

- [ ] **Step 3: Add the service** — `apps/api/core/files/services.py`

Add `from django.conf import settings` to the Django imports (next to
`from django.db import transaction`). Then, directly after `get_download_url`:

```python
def get_display_url(file: File) -> str | None:
    """A link for rendering the file inline (an avatar), or ``None`` if it must not show.

    Checks ``deleted_at`` itself: ``select_related`` joins a soft-deleted row regardless of
    the default manager.
    """
    if file.status != FileStatus.READY or file.deleted_at is not None:
        return None
    ttl = settings.FILE_DISPLAY_URL_TTL_SECONDS
    return get_presigner().presign_download(
        storage_key=file.storage_key,
        expires_in=ttl,
        cache_control=f"private, max-age={ttl}",
    )
```

- [ ] **Step 4: Add the field** — `apps/api/core/files/serializers.py`

Replace the imports with:

```python
from __future__ import annotations

from typing import Any

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from core.files.models import File
from core.files.services import get_display_url
```

Append:

```python
@extend_schema_field(OpenApiTypes.URI)
class SignedFileURLField(serializers.Field):
    """Read-only, time-limited display link for the file behind a ``File`` foreign key.

    ``source`` names the relation: ``SignedFileURLField(source="photo_file")``. DRF emits
    ``null`` for an empty relation; ``get_display_url`` decides the rest. Pair it with
    ``select_related`` on that relation, or every row costs a query.
    """

    def __init__(self, **kwargs: Any) -> None:
        kwargs["read_only"] = True
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def to_representation(self, value: File) -> str | None:
        return get_display_url(value)
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/config/settings/base.py apps/api/core/files/services.py apps/api/core/files/serializers.py apps/api/core/files/tests/test_display_url.py
git commit -m "feat(files): add SignedFileURLField for inline display links

get_display_url() signs a GET link for a ready, non-deleted file, valid for
FILE_DISPLAY_URL_TTL_SECONDS (default 1 h) and cacheable only privately.
SignedFileURLField exposes it for any File foreign key, so staff, students and
guardians share one implementation."
```

- [ ] **Step 6: Push and read CI**

```bash
git push origin feat/dashboard-demo1-real-data && gh pr checks 76 --watch --interval 30
```
Expected: `api` → `test`, `lint`, `typecheck`, `OpenAPI schema is current` pass (no serializer in
use yet, so the schema is unchanged).

---

### Task 4: `photo_url` on the staff API

**Files:**
- Modify: `apps/api/apps/staff_management/staff/serializers.py` (import; field; `Meta.fields`)
- Modify: `apps/api/apps/staff_management/staff/viewset.py:107-120` (`get_queryset`)
- Test: `apps/api/apps/staff_management/staff/tests/test_endpoints.py`
- Regenerate: `apps/api/openapi.yaml`, `packages/api-client/src/schema.d.ts`

**Interfaces:**
- Consumes: `SignedFileURLField` (Task 3).
- Produces: `photo_url: string | null` (read-only, `format: uri`) on every `/staff` list,
  retrieve, create, update and `:exit` response.

- [ ] **Step 1: Write the tests** — `apps/api/apps/staff_management/staff/tests/test_endpoints.py`

Add to the imports:

```python
from django.db import connection
from django.test.utils import CaptureQueriesContext

from core.files.models import FileStatus
from core.files.tests.factories import FileFactory
```

Append:

```python
class StaffPhotoUrlTests(StaffManagementAPITestCase):
    def _staff_with_photo(self, **file_overrides):
        with tenant_context(self.tenant.id):
            photo = FileFactory(
                tenant=self.tenant, purpose="staff.photo", mime_type="image/png", **file_overrides
            )
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, photo_file=photo)
        return staff, photo

    def test_list_and_retrieve_carry_a_link_for_a_ready_photo(self) -> None:
        self.allow("staff.staff.view")
        staff, photo = self._staff_with_photo()

        listed = self.client.get("/api/v1/staff").json()["data"][0]
        retrieved = self.client.get(f"/api/v1/staff/{staff.pk}").json()["data"]

        for payload in (listed, retrieved):
            self.assertEqual(payload["photo_file_id"], str(photo.pk))
            self.assertIn(photo.storage_key, payload["photo_url"])

    def test_no_photo_or_an_unconfirmed_upload_is_null(self) -> None:
        self.allow("staff.staff.view")
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus)
        self._staff_with_photo(status=FileStatus.PENDING)

        rows = self.client.get("/api/v1/staff").json()["data"]

        self.assertEqual([row["photo_url"] for row in rows], [None, None])

    def test_photo_url_is_read_only(self) -> None:
        self.allow("staff.staff.view", "staff.staff.update")
        staff, photo = self._staff_with_photo()

        response = self.client.patch(
            f"/api/v1/staff/{staff.pk}",
            {"photo_url": "https://attacker.invalid/x.png"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertIn(photo.storage_key, response.json()["data"]["photo_url"])

    def test_listing_photos_costs_no_query_per_row(self) -> None:
        self.allow("staff.staff.view")
        self._staff_with_photo()
        # Warm-up: the first request fills per-process caches (feature flags,
        # permissions), which would otherwise make the second measurement look cheaper.
        self.client.get("/api/v1/staff")
        with CaptureQueriesContext(connection) as one_row:
            self.client.get("/api/v1/staff")

        for _ in range(4):
            self._staff_with_photo()
        with CaptureQueriesContext(connection) as five_rows:
            response = self.client.get("/api/v1/staff")

        self.assertEqual(len(response.json()["data"]), 5)
        self.assertEqual(len(five_rows), len(one_row))
```

- [ ] **Step 2: Add the field** — `apps/api/apps/staff_management/staff/serializers.py`

Add the import after `from core.files.models import File`:

```python
from core.files.serializers import SignedFileURLField
```

Directly below `photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)`:

```python
    # The photo above as a display link. get_queryset's select_related("photo_file") keeps it
    # from costing a query per row.
    photo_url = SignedFileURLField(source="photo_file")
```

In `Meta.fields`, directly after `"photo_file_id",`:

```python
            "photo_url",
```

- [ ] **Step 3: Join the file row** — `apps/api/apps/staff_management/staff/viewset.py`, in `get_queryset`

Replace the comment and `select_related` line:

```python
        # select_related keeps the list off a campus/department/designation/photo fetch
        # per row; the annotations are what `?ordering=<...>_name` sorts on, and
        # they reuse those same joins rather than adding their own.
        return (
            super()
            .get_queryset()
            .select_related("campus", "department", "designation", "photo_file")
```
(the `.annotate(...)` below it is unchanged).

- [ ] **Step 4: Regenerate the contract** (code generation, not a check)

```bash
apps/api/scripts/generate-openapi.sh
pnpm --filter @schoolhub/api-client generate
git diff --stat -- apps/api/openapi.yaml packages/api-client/src/schema.d.ts
```
If host `uv` is unavailable: `docker exec schoolhub-api python manage.py spectacular --file openapi.yaml --validate --fail-on-warn`.
Expected: both files change only by `photo_url` (`type: string`, `format: uri`, `readOnly: true`,
`nullable: true`) on `Staff` and `PatchedStaff`, and `photo_url: string | null` in `schema.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/apps/staff_management/staff/serializers.py apps/api/apps/staff_management/staff/viewset.py apps/api/apps/staff_management/staff/tests/test_endpoints.py apps/api/openapi.yaml packages/api-client/src/schema.d.ts
git commit -m "feat(staff): expose photo_url, a signed display link for the staff photo

Read-only, null unless the photo's upload is confirmed. The list joins the file
row, so a page of photos is still one query."
```

- [ ] **Step 6: Push and read CI**

```bash
git push origin feat/dashboard-demo1-real-data && gh pr checks 76 --watch --interval 30
```
Expected: `api` → all green, including `OpenAPI schema is current`.

---

### Task 5: Dashboard — photos in the directory and the edit dialog

**Files:**
- Modify: `apps/dashboard/src/services/modules/dashboard/dashboard-service.ts` (`StaffDirectoryRecord`, `StaffDetailRecord`)
- Modify: `apps/dashboard/src/app/(app)/staff/staff-directory-table.tsx` (`StaffRow`, `rows`, Member cell, `initialsOf` comment, imports)
- Modify: `apps/dashboard/src/app/(app)/staff/staff-form-dialog.tsx` (preview block)
- Test: `apps/dashboard/src/app/(app)/staff/__tests__/staff-directory-table.test.tsx`
- Test: `apps/dashboard/src/app/(app)/staff/__tests__/staff-form-dialog.test.tsx`
- Fixtures only: `apps/dashboard/src/app/(app)/staff/__tests__/exit-staff-dialog.test.tsx`,
  `apps/dashboard/src/app/(app)/shell/dashboard/__tests__/teams.test.tsx`,
  `apps/dashboard/src/services/modules/dashboard/__tests__/dashboard-service.test.ts`

**Interfaces:**
- Consumes: `photo_url: string | null` on `/staff` responses (Task 4).
- Produces: `StaffDirectoryRecord.photo_url`, `StaffDetailRecord.photo_url` (both `string | null`).

- [ ] **Step 1: Add `photo_url` to the record types** — `dashboard-service.ts`

In `StaffDirectoryRecord`, after `updated_at: string;`:

```ts
  /** Signed display link for the staff photo (`StaffSerializer.photo_url`), or `null` when
   * there is none or its upload isn't confirmed. It expires (1 h) and can fail to load, so
   * always render it over an initials fallback. */
  photo_url: string | null;
```

In `StaffDetailRecord`, after `photo_file_id: string | null;`:

```ts
  photo_url: string | null;
```

- [ ] **Step 2: Add `photo_url` to every typed staff fixture**

Every object literal that ends in an `updated_at: "…"` line in these files is a
`StaffDirectoryRecord`; add `photo_url: null` after it:

```bash
cd apps/dashboard
perl -0pi -e 's/^([ \t]*)updated_at: ("[^"]+"),\n/$1updated_at: $2,\n$1photo_url: null,\n/mg' \
  "src/app/(app)/staff/__tests__/staff-directory-table.test.tsx" \
  "src/app/(app)/staff/__tests__/staff-form-dialog.test.tsx" \
  "src/app/(app)/staff/__tests__/exit-staff-dialog.test.tsx" \
  "src/app/(app)/shell/dashboard/__tests__/teams.test.tsx" \
  "src/services/modules/dashboard/__tests__/dashboard-service.test.ts"
grep -c "photo_url: null" "src/app/(app)/staff/__tests__/staff-directory-table.test.tsx" "src/app/(app)/staff/__tests__/staff-form-dialog.test.tsx" "src/app/(app)/staff/__tests__/exit-staff-dialog.test.tsx" "src/app/(app)/shell/dashboard/__tests__/teams.test.tsx" "src/services/modules/dashboard/__tests__/dashboard-service.test.ts"
```
Expected counts: 2, 4, 1, 5, 5. Then, in `staff-form-dialog.test.tsx`'s `detailRecord()` (a
`StaffDetailRecord`, which has no `updated_at`), add after `photo_file_id: null,`:

```ts
    photo_url: null,
```

- [ ] **Step 3: Write the directory-table tests** — `staff-directory-table.test.tsx`

Below `popoverTrigger`, add:

```tsx
/** jsdom never loads images, so Radix's `AvatarImage` would wait forever. Report every
 * image as already loaded (width 1) or broken (width 0); returns the restore function. */
function stubImageLoading(result: "loaded" | "broken") {
  const complete = jest.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  const width = jest
    .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
    .mockReturnValue(result === "loaded" ? 1 : 0);
  return () => {
    complete.mockRestore();
    width.mockRestore();
  };
}
```

Rename the first test from `"renders a page of staff: name, role, status badge, campus, and initials (never a photo)"`
to `"renders a page of staff: name, role, status badge, campus, and initials when there is no photo"`
and delete its two-line comment starting `// No \`AvatarImage\`/\`src\` is ever rendered`.

Add after it:

```tsx
  it("shows the staff photo when the record has one", async () => {
    const restoreImages = stubImageLoading("loaded");
    try {
      mockFetchStaffPage.mockResolvedValue({
        items: [{ ...staffRecord(), photo_url: "https://storage.test/ayesha.png" }],
        pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
      });

      renderWithProviders(<StaffDirectoryTable />);

      const row = (await screen.findByText("Ayesha Khan")).closest("tr") as HTMLElement;
      // Decorative (`alt=""` — the name sits beside it), so it has no accessible role.
      await waitFor(() => {
        expect(row.querySelector("img")).toHaveAttribute("src", "https://storage.test/ayesha.png");
      });
      expect(within(row).queryByText("AK")).not.toBeInTheDocument();
    } finally {
      restoreImages();
    }
  });

  it("falls back to initials when the photo fails to load", async () => {
    const restoreImages = stubImageLoading("broken");
    try {
      mockFetchStaffPage.mockResolvedValue({
        items: [{ ...staffRecord(), photo_url: "https://storage.test/expired.png" }],
        pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
      });

      renderWithProviders(<StaffDirectoryTable />);

      const row = (await screen.findByText("Ayesha Khan")).closest("tr") as HTMLElement;
      expect(await within(row).findByText("AK")).toBeInTheDocument();
      expect(row.querySelector("img")).toBeNull();
    } finally {
      restoreImages();
    }
  });
```

- [ ] **Step 4: Render the photo** — `staff-directory-table.tsx`

Add `AvatarImage,` to the `@schoolhub/ui` import, directly after `AvatarFallback,`.

`StaffRow` — add after `updatedAt: string;`:

```ts
  photoUrl: string | null;
```

`rows` mapping — add after `updatedAt: staff.updated_at,`:

```ts
        photoUrl: staff.photo_url,
```

Member cell — replace the `<Avatar …>…</Avatar>` block:

```tsx
            <Avatar className="size-9 shrink-0">
              {row.original.photoUrl ? <AvatarImage src={row.original.photoUrl} alt="" /> : null}
              <AvatarFallback>{initialsOf(row.original.name)}</AvatarFallback>
            </Avatar>
```

`initialsOf` doc comment — replace the whole comment above `function initialsOf` with:

```ts
/** Same convention as `shell/partials/topbar/user-dropdown-menu.tsx`'s own `initialsOf`
 * (non-null-assertion-free array destructure) — duplicated rather than imported since
 * that one is private to its own module. Also what shows while a photo loads, and
 * whenever it fails to (an expired link, a deleted object). */
```

Then `grep -n "photo" "src/app/(app)/staff/staff-directory-table.tsx"` and remove any remaining
comment that claims no photo URL exists.

- [ ] **Step 5: Write the edit-dialog tests** — `staff-form-dialog.test.tsx`

Add the same `stubImageLoading` helper as Step 3 below `setDate`, plus a typed handle on the
upload mock next to the other `mock…` constants (the file's own convention):

```tsx
const mockUploadFile = Services.files.uploadFile as jest.MockedFunction<
  typeof Services.files.uploadFile
>;

/** jsdom has no object URLs; the dialog creates one for a picked file's local preview.
 * Descriptors, not method references, so restoring trips no unbound-method lint. */
function stubObjectUrls(url: string) {
  const saved = ["createObjectURL", "revokeObjectURL"].map(
    (name) => [name, Object.getOwnPropertyDescriptor(URL, name)] as const,
  );
  Object.defineProperty(URL, "createObjectURL", { value: jest.fn(() => url), configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: jest.fn(), configurable: true });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(URL, name, descriptor);
      else Reflect.deleteProperty(URL, name);
    }
  };
}
```

Inside `describe("edit mode", …)`, append:

```tsx
    it("shows the saved photo in the preview", async () => {
      const restoreImages = stubImageLoading("loaded");
      try {
        mockReferenceData();
        mockFetchStaffById.mockResolvedValue(
          detailRecord({ photo_file_id: "file-1", photo_url: "https://storage.test/ayesha.png" }),
        );

        renderWithProviders(
          <StaffFormDialog open mode="edit" staffId="st-1" onOpenChange={jest.fn()} />,
        );

        const dialog = await screen.findByRole("dialog", { name: "Edit staff member" });
        await waitFor(() => {
          expect(dialog.querySelector("img")).toHaveAttribute(
            "src",
            "https://storage.test/ayesha.png",
          );
        });
        expect(within(dialog).queryByText("Photo on file")).not.toBeInTheDocument();
      } finally {
        restoreImages();
      }
    });

    it("shows the newly picked photo instead of the saved one", async () => {
      const restoreImages = stubImageLoading("loaded");
      const restoreObjectUrls = stubObjectUrls("blob:new-photo");
      try {
        mockReferenceData();
        mockFetchStaffById.mockResolvedValue(
          detailRecord({ photo_file_id: "file-1", photo_url: "https://storage.test/ayesha.png" }),
        );
        mockUploadFile.mockResolvedValue("file-2");
        const user = userEvent.setup();

        renderWithProviders(
          <StaffFormDialog open mode="edit" staffId="st-1" onOpenChange={jest.fn()} />,
        );

        const dialog = await screen.findByRole("dialog", { name: "Edit staff member" });
        await user.upload(
          within(dialog).getByLabelText("Staff photo"),
          new File(["png"], "new.png", { type: "image/png" }),
        );

        await waitFor(() => {
          expect(dialog.querySelector("img")).toHaveAttribute("src", "blob:new-photo");
        });
      } finally {
        restoreObjectUrls();
        restoreImages();
      }
    });
```
Add `within` to the `@testing-library/react` import if it is not already there.

- [ ] **Step 6: Show the saved photo** — `staff-form-dialog.tsx`

Directly below `const photoFileId = form.watch("photo_file_id");`:

```tsx
  // The saved photo, until the user picks a replacement: once `photo_file_id` no longer
  // matches the record's, the saved link is for the old photo.
  const savedPhoto = mode === "edit" ? staffDetailQuery.data : undefined;
  const savedPhotoUrl =
    savedPhoto && photoFileId === (savedPhoto.photo_file_id ?? "") ? savedPhoto.photo_url : null;
  const previewUrl = localPreviewUrl ?? savedPhotoUrl;
```

In the preview block, replace:

```tsx
                        {localPreviewUrl ? <AvatarImage src={localPreviewUrl} alt="" /> : null}
```
with:
```tsx
                        {previewUrl ? <AvatarImage src={previewUrl} alt="" /> : null}
```

and replace the "Photo on file" condition:

```tsx
                        {uploadStatus !== "uploading" && !previewUrl && photoFileId ? (
```
(the text now shows only for a photo that has no displayable link, e.g. an unconfirmed upload).

Then `grep -n "resolvable\|no url\|photo_file_id has no" "src/app/(app)/staff/staff-form-dialog.tsx"`
and remove any comment that claims no photo URL exists.

- [ ] **Step 7: Format** (formatter, not a check)

```bash
node_modules/.bin/prettier --write apps/dashboard/src/services/modules/dashboard/dashboard-service.ts "apps/dashboard/src/app/(app)/staff/staff-directory-table.tsx" "apps/dashboard/src/app/(app)/staff/staff-form-dialog.tsx" "apps/dashboard/src/app/(app)/staff/__tests__/staff-directory-table.test.tsx" "apps/dashboard/src/app/(app)/staff/__tests__/staff-form-dialog.test.tsx" "apps/dashboard/src/app/(app)/staff/__tests__/exit-staff-dialog.test.tsx" "apps/dashboard/src/app/(app)/shell/dashboard/__tests__/teams.test.tsx" apps/dashboard/src/services/modules/dashboard/__tests__/dashboard-service.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): show staff photos in the directory and the edit dialog

Render photo_url with Radix AvatarImage over the initials fallback, which also
covers a link that expires or fails to load. The edit dialog previews the saved
photo until a replacement is picked."
```

- [ ] **Step 9: Push and read CI**

```bash
git push origin feat/dashboard-demo1-real-data && gh pr checks 76 --watch --interval 30
```
Expected: `frontend` → `Lint · Typecheck` green; `Test (coverage)` shows every dashboard test
passing (the job itself stays red on the known coverage floor — confirm with
`gh run view <id> --log-failed | grep -E "Tests:|FAIL"`).

---

### Task 6: E2E — a real `<img>` in Chromium

jsdom can only fake image loading; this proves the browser actually renders the photo.

**Files:**
- Modify: `e2e/src/mocks/domains/staff.ts` (`Staff` interface, `buildStaff`)
- Modify: `e2e/src/pages/dashboard/staff.page.ts` (new locator)
- Test: `e2e/tests/dashboard/staff.spec.ts`

**Interfaces:**
- Consumes: `photo_url` rendering (Task 5).
- Produces: `buildStaff({ photo_url })`; `StaffPage.rowPhoto(name: string): Locator`.

- [ ] **Step 1: Mock the field** — `e2e/src/mocks/domains/staff.ts`

In `interface Staff`, after `photo_file_id: string | null;`:

```ts
  photo_url: string | null;
```

In `buildStaff`'s returned object, after `photo_file_id: null,`:

```ts
    photo_url: null,
```

- [ ] **Step 2: Add the locator** — `e2e/src/pages/dashboard/staff.page.ts`, after `row(...)`

```ts
  /** A row's avatar photo. Decorative (`alt=""`, the name sits beside it), so it has no
   * accessible name to locate by — the element is the only handle. */
  rowPhoto(name: string): Locator {
    return this.row(name).locator("img");
  }
```

- [ ] **Step 3: Write the test** — `e2e/tests/dashboard/staff.spec.ts`

Below the `designation` constant, add:

```ts
const PHOTO_URL = "https://storage.e2e.test/tenants/e2e/staff.photo/ayesha.png";
// A 1×1 PNG — enough for Chromium to decode and report a natural width.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
```

In `directory()`, give Ayesha a photo — add to her `buildStaff({...})` overrides:

```ts
      photo_url: PHOTO_URL,
```

In `test.beforeEach`, before `await staffPage.goto();`, add `page` to its destructured fixtures
and serve the photo (storage is not the API, so `MockApi` does not see it):

```ts
    await page.route(PHOTO_URL, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
    );
```

Append inside `test.describe("staff directory", …)`:

```ts
  test("shows a staff member's photo, and initials for one without", async ({ staffPage }) => {
    const photo = staffPage.rowPhoto("Ayesha Khan");
    await expect(photo).toHaveAttribute("src", PHOTO_URL);
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);

    await expect(staffPage.rowPhoto("Bilal Ahmed")).toHaveCount(0);
    await expect(staffPage.row("Bilal Ahmed").getByText("BA")).toBeVisible();
  });
```

- [ ] **Step 4: Format, commit** (formatter, not a check)

```bash
node_modules/.bin/prettier --write e2e/src/mocks/domains/staff.ts e2e/src/pages/dashboard/staff.page.ts e2e/tests/dashboard/staff.spec.ts
git add e2e
git commit -m "test(e2e): prove staff photos render as real images in Chromium

A row whose photo_url points at a stubbed image shows a decoded <img>; a row
without one shows initials."
```

- [ ] **Step 5: Push and read CI**

```bash
git push origin feat/dashboard-demo1-real-data && gh pr checks 76 --watch --interval 30
```
Expected: in the `E2E (Playwright)` job, all `staff.spec.ts` tests pass
(`gh run view <id> --log | grep "staff.spec"`); the job's six pre-existing failures are unchanged.

---

### Task 7: Status doc, manual check, final CI

**Files:**
- Modify: `docs/project-status.md` (the `core.files` bullet under "Deliberately NOT done")

- [ ] **Step 1: Record the capability** — `docs/project-status.md`

After the bullet that starts `- **\`core.files\` now exists** (PR 2):` and ends
`\`api-architecture.md\` §11, not an oversight.`, add:

```markdown
- **Inline display links for files** (PR #76): `core.files.serializers.SignedFileURLField`
  turns any `File` foreign key into a read-only signed GET link (`get_display_url()`), valid
  `FILE_DISPLAY_URL_TTL_SECONDS` (default 1 h) and `null` unless the file is `ready` and not
  soft-deleted. `StaffSerializer.photo_url` uses it, and the dashboard's staff directory and
  edit dialog render it over an initials fallback. Students and guardians still expose only
  `photo_file_id` — one `SignedFileURLField(source="photo_file")` line each, plus
  `select_related("photo_file")`, when their screens need photos. The signer is now one shared
  SigV4 instance per process (`get_presigner()`), signing for `S3_PUBLIC_ENDPOINT_URL`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/project-status.md
git commit -m "docs(project-status): record inline display links and staff photos"
```

- [ ] **Step 3: Manual check against the running stack**

With `pnpm dev` and the compose stack up: sign in at `http://localhost:3000` as
`owner@demo.localhost` / `demo12345`, open `/staff`, edit a staff member, upload a photo, save.
Expected: the toast is light; the row shows the photo; reopening Edit shows the saved photo; the
image request goes to `localhost:9000` with `X-Amz-Algorithm=AWS4-HMAC-SHA256` (DevTools →
Network).

- [ ] **Step 4: Push and read CI**

```bash
git push origin feat/dashboard-demo1-real-data && gh pr checks 76 --watch --interval 30
```
Expected: everything green except the two known-red checks, with no new failures inside them.
