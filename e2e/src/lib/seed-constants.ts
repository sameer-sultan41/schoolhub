/**
 * Mirrors identifiers `apps/api/core/rbac/management/commands/seed_e2e_data.py` seeds.
 * There is no cross-language build-time coupling between the two — keep these in sync
 * manually if the Python side ever renames one — but centralizing the value here means
 * a second TS consumer greps to this file instead of hardcoding a second copy.
 */

/** Mirrors seed_e2e_data.py's E2E_OTHER_ADMIN_EMAIL. */
export const E2E_OTHER_ADMIN_EMAIL = "e2e-admin-other@schoolhub.test";
