import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useFileUpload } from "@/hooks/use-file-upload";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({ apiClient: { post: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function apiResult<T>(data: T) {
  return { data, meta: undefined, requestId: null, status: 200 };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useFileUpload", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockPost.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("creates the upload, PUTs the bytes directly to storage, then confirms", async () => {
    const file = new File(["hello"], "birth-certificate.pdf", { type: "application/pdf" });
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    mockPost.mockResolvedValueOnce(
      apiResult({
        id: "f1",
        original_name: "birth-certificate.pdf",
        mime_type: "application/pdf",
        size_bytes: 5,
        purpose: "student.document",
        status: "pending",
        visibility: "tenant",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        upload_url: "https://storage.invalid/f1",
        upload_method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        expires_at: "2026-04-01T00:15:00Z",
      }),
    );
    mockPost.mockResolvedValueOnce(apiResult({ id: "f1", status: "ready" }));

    const { result } = renderHook(() => useFileUpload(), { wrapper });
    result.current.mutate({ file, purpose: "student.document" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://storage.invalid/f1",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      }),
    );
    expect(mockPost).toHaveBeenNthCalledWith(2, "/files/f1:confirm");
    expect(result.current.data).toEqual({ id: "f1", status: "ready" });
  });

  it("fails the mutation when the direct-to-storage PUT is rejected", async () => {
    const file = new File(["hello"], "photo.png", { type: "image/png" });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });

    mockPost.mockResolvedValueOnce(
      apiResult({
        id: "f2",
        original_name: "photo.png",
        mime_type: "image/png",
        size_bytes: 5,
        purpose: "student.photo",
        status: "pending",
        visibility: "tenant",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        upload_url: "https://storage.invalid/f2",
        upload_method: "PUT",
        headers: {},
        expires_at: "2026-04-01T00:15:00Z",
      }),
    );

    const { result } = renderHook(() => useFileUpload(), { wrapper });
    result.current.mutate({ file, purpose: "student.photo" });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Only the create-upload call happened — never a second call to :confirm.
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
