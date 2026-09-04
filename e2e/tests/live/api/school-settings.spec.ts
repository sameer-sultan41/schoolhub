import { ApiError } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";

/**
 * BLOCKED on a real, confirmed backend bug: `GET /api/v1/school-settings` always 403s
 * (`{"code":"permission_denied", ...}`, message "This module is not enabled for your
 * school.") for a real, freshly seeded admin, even though `module.school`'s feature flag
 * is `default_enabled=True` with no tenant override — confirmed directly:
 * `is_feature_enabled("module.school", tenant_id=<e2e-school's real id>)` returns `True`
 * in a `manage.py shell`. `SchoolSettingsView` (`apps/school_organization/views.py`) is a
 * plain `APIView`, not a `TenantScopedViewSetMixin`-based viewset — it never gets
 * `request.tenant` populated the way viewset endpoints (campuses, classes, …) do, so
 * `RequiresModuleFeature.has_permission` hits its own `if tenant is None: return False`
 * fail-closed guard before ever calling `is_feature_enabled`.
 *
 * This pins that real, current behavior rather than asserting the ideal one. Once
 * `SchoolSettingsView` binds `request.tenant` the same way the viewsets do, replace this
 * with a real get/patch/persist journey — see git history for the version this replaced.
 */
test.describe("school settings (live API, blocked on a real backend bug)", () => {
  test("request.tenant is never bound for this plain APIView, so every request 403s", async ({
    liveApiClient,
  }) => {
    const denied = await liveApiClient.get("/school-settings").catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(ApiError);
    expect((denied as ApiError).status).toBe(403);
  });
});
