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

function fakeFile(): File {
  return new File(["hello"], "photo.png", { type: "image/png" });
}

describe("uploadFile", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    mockPost.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("creates, PUTs the bytes to the presigned URL, confirms, and resolves the file id", async () => {
    const { uploadFile } = await import("../files-service");
    mockPost.mockImplementation((path: string) => {
      if (path === "/files") {
        return Promise.resolve({
          data: {
            id: "file-1",
            upload_url: "https://storage.example.com/tenants/t1/staff_photo/abc-photo.png",
            upload_method: "PUT",
            headers: { "Content-Type": "image/png" },
          },
        });
      }
      // The confirm call
      return Promise.resolve({ data: { id: "file-1", status: "ready" } });
    });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const fileId = await uploadFile(fakeFile(), "staff_photo");

    expect(fileId).toBe("file-1");
    expect(mockPost).toHaveBeenNthCalledWith(1, "/files", {
      original_name: "photo.png",
      mime_type: "image/png",
      size_bytes: 5,
      purpose: "staff_photo",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example.com/tenants/t1/staff_photo/abc-photo.png",
      expect.objectContaining({ method: "PUT", headers: { "Content-Type": "image/png" } }),
    );
    expect(mockPost).toHaveBeenNthCalledWith(2, "/files/file-1:confirm");
  });

  it("throws a create-step error and never PUTs or confirms when POST /files fails", async () => {
    const { uploadFile, FileUploadError } = await import("../files-service");
    mockPost.mockRejectedValue(new Error("boom"));
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(uploadFile(fakeFile(), "staff_photo")).rejects.toMatchObject({
      step: "create",
    });
    await expect(uploadFile(fakeFile(), "staff_photo")).rejects.toBeInstanceOf(FileUploadError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a put-step error and never confirms when the storage PUT fails", async () => {
    const { uploadFile } = await import("../files-service");
    mockPost.mockResolvedValueOnce({
      data: {
        id: "file-1",
        upload_url: "https://storage.example.com/key",
        upload_method: "PUT",
        headers: { "Content-Type": "image/png" },
      },
    });
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(uploadFile(fakeFile(), "staff_photo")).rejects.toMatchObject({ step: "put" });
    // Only the /files create call happened — no :confirm call.
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("throws a confirm-step error when the confirm call fails after a successful upload", async () => {
    const { uploadFile } = await import("../files-service");
    mockPost.mockResolvedValueOnce({
      data: {
        id: "file-1",
        upload_url: "https://storage.example.com/key",
        upload_method: "PUT",
        headers: { "Content-Type": "image/png" },
      },
    });
    mockPost.mockRejectedValueOnce(new Error("confirm failed"));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

    await expect(uploadFile(fakeFile(), "staff_photo")).rejects.toMatchObject({ step: "confirm" });
  });
});
