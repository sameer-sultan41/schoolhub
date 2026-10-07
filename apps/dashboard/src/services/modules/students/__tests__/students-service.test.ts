import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: mockDelete,
      refresh: jest.fn(),
    })),
  };
});

describe("students-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("fetchStudentsPage sends filters as snake_case query params", async () => {
    const { fetchStudentsPage } = await import("../students-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } },
    });

    await fetchStudentsPage({
      page: 1,
      pageSize: 10,
      search: "ali",
      status: "active",
      campusId: "c1",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/students",
      expect.objectContaining({
        query: { page: 1, page_size: 10, search: "ali", status: "active", campus_id: "c1" },
      }),
    );
  });

  it("fetchStudentById requests the single-student endpoint and returns its data", async () => {
    const { fetchStudentById } = await import("../students-service");
    mockGet.mockResolvedValue({ data: { id: "s1", first_name: "Ali" } });

    const result = await fetchStudentById("s1");

    expect(mockGet).toHaveBeenCalledWith("/students/s1");
    expect(result).toEqual({ id: "s1", first_name: "Ali" });
  });

  it("createStudent maps camelCase input to the snake_case request body", async () => {
    const { createStudent } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "s1" } });

    await createStudent({
      firstName: "Ali",
      lastName: "Khan",
      dateOfBirth: "2012-05-01",
      gender: "male",
      campusId: "c1",
      admissionDate: "2026-01-10",
    });

    expect(mockPost).toHaveBeenCalledWith("/students", {
      first_name: "Ali",
      last_name: "Khan",
      date_of_birth: "2012-05-01",
      gender: "male",
      campus_id: "c1",
      admission_date: "2026-01-10",
    });
  });

  it("createStudent sends an explicit null through rather than silently dropping it", async () => {
    // `createStudent` used to build its body with truthy checks
    // (`...(input.houseId ? {...} : {})`), which would drop a falsy-but-explicit value —
    // including `null` — the same way it'd drop an empty string, unlike `updateStudent`'s
    // own `!== undefined` checks right below, which only ever drop `undefined`.
    const { createStudent } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "s1" } });

    await createStudent({
      firstName: "Ali",
      lastName: "Khan",
      dateOfBirth: "2012-05-01",
      gender: "male",
      campusId: "c1",
      admissionDate: "2026-01-10",
      houseId: null,
    });

    expect(mockPost).toHaveBeenCalledWith("/students", expect.objectContaining({ house_id: null }));
  });

  it("updateStudent sends null (not omitted) for an explicitly cleared house", async () => {
    const { updateStudent } = await import("../students-service");
    mockPatch.mockResolvedValue({ data: { id: "s1" } });

    await updateStudent("s1", { houseId: null });

    expect(mockPatch).toHaveBeenCalledWith("/students/s1", { house_id: null });
  });

  it("withdrawStudent posts to the colon-action path with an Idempotency-Key", async () => {
    const { withdrawStudent } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "s1", status: "withdrawn" } });

    await withdrawStudent("s1", { reason: "Relocated", effectiveDate: "2026-02-01" }, "key-abc");

    expect(mockPost).toHaveBeenCalledWith(
      "/students/s1:withdraw",
      { reason: "Relocated", effective_date: "2026-02-01", waive_clearance: false },
      expect.objectContaining({ idempotencyKey: "key-abc" }),
    );
  });
});

describe("students-service — emergency contacts and documents", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it("fetchEmergencyContacts lists a student's contacts, ordered by priority", async () => {
    const { fetchEmergencyContacts } = await import("../students-service");
    // EmergencyContactLinkViewSet doesn't override pagination_class, so it inherits the
    // project default CursorPagination (apps/api/core/api/pagination.py) — only
    // StudentViewSet (this file's other tests) uses page numbers.
    mockGet.mockResolvedValue({
      data: [{ id: "c1", priority: 1 }],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 50 } },
    });

    const result = await fetchEmergencyContacts("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/students/student-1/emergency-contacts",
      expect.objectContaining({ query: { ordering: "priority", page_size: 50 } }),
    );
    expect(result).toEqual([{ id: "c1", priority: 1 }]);
  });

  it("addEmergencyContact posts the contact fields, omitting unfilled optionals", async () => {
    const { addEmergencyContact } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "c1" } });

    await addEmergencyContact("student-1", {
      name: "Hamza Raza",
      relationship: "Uncle",
      phone: "0300-0000000",
      priority: 2,
    });

    expect(mockPost).toHaveBeenCalledWith("/students/student-1/emergency-contacts", {
      name: "Hamza Raza",
      relationship: "Uncle",
      phone: "0300-0000000",
      priority: 2,
    });
  });

  it("fetchDocuments lists a student's documents", async () => {
    const { fetchDocuments } = await import("../students-service");
    mockGet.mockResolvedValue({
      data: [{ id: "d1" }],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 50 } },
    });

    const result = await fetchDocuments("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/students/student-1/documents",
      expect.objectContaining({ query: { page_size: 50 } }),
    );
    expect(result).toEqual([{ id: "d1" }]);
  });

  it("uploadDocumentRecord posts the already-uploaded file's id plus metadata", async () => {
    const { uploadDocumentRecord } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "d1" } });

    await uploadDocumentRecord("student-1", {
      fileId: "file-1",
      documentType: "birth_certificate",
      title: "Birth certificate",
    });

    expect(mockPost).toHaveBeenCalledWith("/students/student-1/documents", {
      file_id: "file-1",
      document_type: "birth_certificate",
      title: "Birth certificate",
    });
  });

  it("uploadDocumentRecord includes notes and expiresAt only when given", async () => {
    const { uploadDocumentRecord } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "d1" } });

    await uploadDocumentRecord("student-1", {
      fileId: "file-1",
      documentType: "other",
      title: "Note",
      notes: "Handwritten note from the guardian",
      expiresAt: "2027-01-01",
    });

    expect(mockPost).toHaveBeenCalledWith("/students/student-1/documents", {
      file_id: "file-1",
      document_type: "other",
      title: "Note",
      notes: "Handwritten note from the guardian",
      expires_at: "2027-01-01",
    });
  });

  it("deleteDocument deletes by document id", async () => {
    const { deleteDocument } = await import("../students-service");
    mockDelete.mockResolvedValue({});

    await deleteDocument("d1");

    expect(mockDelete).toHaveBeenCalledWith("/student-documents/d1");
  });

  it("verifyDocument posts the decision to the colon-action", async () => {
    const { verifyDocument } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "d1", verification_status: "verified" } });

    const result = await verifyDocument("d1", "verified");

    expect(mockPost).toHaveBeenCalledWith("/student-documents/d1:verify", { decision: "verified" });
    expect(result).toEqual({ id: "d1", verification_status: "verified" });
  });

  it("getDocumentDownloadUrl posts to the document's own :download action and returns the url", async () => {
    const { getDocumentDownloadUrl } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { download_url: "https://files.example.com/x?sig=abc" } });

    const result = await getDocumentDownloadUrl("d1");

    expect(mockPost).toHaveBeenCalledWith("/student-documents/d1:download");
    expect(result).toBe("https://files.example.com/x?sig=abc");
  });
});
