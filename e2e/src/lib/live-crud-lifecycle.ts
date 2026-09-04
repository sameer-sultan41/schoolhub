import { ApiError, type ApiClient, type ApiResult } from "@schoolhub/api-client";
import { expect } from "@/fixtures";

interface CrudLifecycleOptions<TResource extends { id: string }> {
  liveApiClient: ApiClient;
  /** e.g. "/campuses" */
  endpoint: string;
  /** e.g. buildLiveCampus */
  build: () => Record<string, unknown>;
  /** Body sent to PATCH, e.g. `{ name: "Renamed" }`. */
  patch: Record<string, unknown>;
  /** Asserts the patched resource reflects `patch`. */
  assertPatched: (resource: TResource) => void;
  /** Optional extra checks against the just-created resource (e.g. a generated code). */
  assertCreated?: (resource: TResource) => void;
  /** Optional extra checks against the list response (e.g. pagination meta). */
  assertListed?: (listed: ApiResult<TResource[]>) => void;
}

/**
 * The create -> list -> patch -> delete -> verify-404 shape shared by every simple
 * school_organization resource's live spec — extracted after four files
 * (campuses/departments/houses/subjects) hand-wrote it near-identically, varying only
 * the endpoint, builder, and patched field.
 */
export async function runCrudLifecycle<TResource extends { id: string }>(
  options: CrudLifecycleOptions<TResource>,
): Promise<void> {
  const { liveApiClient, endpoint, build, patch, assertPatched, assertCreated, assertListed } =
    options;

  const created = await liveApiClient.post(endpoint, build());
  expect(created.status).toBe(201);
  const resource = created.data as TResource;
  assertCreated?.(resource);

  const listed = await liveApiClient.get<TResource[]>(endpoint);
  expect(listed.status).toBe(200);
  expect(listed.data.some((row) => row.id === resource.id)).toBe(true);
  assertListed?.(listed);

  const updated = await liveApiClient.patch(`${endpoint}/${resource.id}`, patch);
  assertPatched(updated.data as TResource);

  const deleted = await liveApiClient.delete(`${endpoint}/${resource.id}`);
  expect(deleted.status).toBe(204);

  const afterDelete = await liveApiClient
    .get(`${endpoint}/${resource.id}`)
    .catch((error: unknown) => error);
  expect(afterDelete).toBeInstanceOf(ApiError);
  expect((afterDelete as ApiError).status).toBe(404);
}
