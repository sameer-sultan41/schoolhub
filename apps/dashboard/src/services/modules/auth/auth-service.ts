/**
 * The auth domain's API calls. Every dashboard consumer reaches these through
 * `Services.auth.*` (see `@/services`) — never by importing `@/lib/auth` directly.
 *
 * `lib/auth.ts` already owns the transport wiring (token store, refresh-on-401, the
 * `apiClient` instance) and its own `fetchCurrentUser`, which already reads
 * `endpoints.auth.me` internally — this just re-exports it under the services
 * convention rather than duplicating it.
 */
export { fetchCurrentUser } from "@/lib/auth";
