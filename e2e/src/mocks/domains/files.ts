import { id } from "@/data/factories";
import { ok } from "../envelope";
import type { MockModule } from "../router";

export interface FilesOptions {
  /** The storage PUT target every upload in a spec resolves to — a fixed URL is enough;
   * nothing in this mock module serves it, a spec's own Playwright `page.route` for this
   * exact URL intercepts the PUT itself (`files-service.ts` sends it with a plain
   * `fetch`, never through this API mock or `apiClient`). */
  uploadUrl?: string;
}

/** `POST /files` — step one of the real three-step upload flow (`files-service.ts`'s
 * own header comment). Step three (`POST /files/{id}:confirm`) is NOT handled here —
 * `e2e/src/mocks/router.ts`'s router has no fallthrough between modules (the
 * most-recently-`.use()`-registered route wins a given path exclusively; a handler
 * genuinely cannot defer to a different module's handler for the same path), so a
 * second handler on `/files/:fileAction` here would shadow `jobsModule`'s existing
 * `:download` handler rather than coexist with it. `:confirm` is added to `jobsModule`
 * itself instead (this task's Step 4) — the one module that already owns that path. */
export function filesModule(options: FilesOptions = {}): MockModule {
  const uploadUrl = options.uploadUrl ?? "https://files.example.test/upload-target";
  return (api) => {
    api.post("/files", (request) => {
      const body = (request.json() as {
        original_name: string;
        mime_type: string;
        size_bytes: number;
      } | null) ?? { original_name: "file", mime_type: "application/octet-stream", size_bytes: 0 };
      return ok(
        {
          id: id("file"),
          ...body,
          upload_url: uploadUrl,
          upload_method: "PUT",
          headers: { "Content-Type": body.mime_type },
          expires_at: "2027-01-01T00:00:00Z",
        },
        { status: 201 },
      );
    });
  };
}
