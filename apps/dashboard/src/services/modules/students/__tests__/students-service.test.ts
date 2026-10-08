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

  it("fetchStudentsPage includes academic_session_id/class_id/section_id when given", async () => {
    const { fetchStudentsPage } = await import("../students-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } },
    });

    await fetchStudentsPage({
      page: 1,
      pageSize: 10,
      academicSessionId: "sess-1",
      classId: "c1",
      sectionId: "sec1",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/students",
      expect.objectContaining({
        query: expect.objectContaining({
          academic_session_id: "sess-1",
          class_id: "c1",
          section_id: "sec1",
        }),
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

  it("enrollStudent posts the mapped snake_case body with an Idempotency-Key", async () => {
    const { enrollStudent } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "e1", status: "active" } });

    await enrollStudent(
      "s1",
      {
        academicSessionId: "sess-1",
        classId: "c1",
        sectionId: "sec1",
        enrollmentDate: "2026-04-05",
      },
      "key-enroll",
    );

    expect(mockPost).toHaveBeenCalledWith(
      "/students/s1:enroll",
      {
        academic_session_id: "sess-1",
        class_id: "c1",
        section_id: "sec1",
        enrollment_date: "2026-04-05",
      },
      expect.objectContaining({ idempotencyKey: "key-enroll" }),
    );
  });

  it("enrollStudent includes roll_number and capacity_override_reason only when given", async () => {
    const { enrollStudent } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "e1" } });

    await enrollStudent(
      "s1",
      {
        academicSessionId: "sess-1",
        classId: "c1",
        sectionId: "sec1",
        enrollmentDate: "2026-04-05",
        rollNumber: "12",
        capacityOverrideReason: "Sibling already enrolled",
      },
      "key-enroll-2",
    );

    expect(mockPost).toHaveBeenCalledWith(
      "/students/s1:enroll",
      expect.objectContaining({
        roll_number: "12",
        capacity_override_reason: "Sibling already enrolled",
      }),
      expect.objectContaining({ idempotencyKey: "key-enroll-2" }),
    );
  });

  it("changeStudentSection posts section_id only — never class_id", async () => {
    const { changeStudentSection } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "e1" } });

    await changeStudentSection("s1", { sectionId: "sec2" }, "key-change");

    expect(mockPost).toHaveBeenCalledWith(
      "/students/s1:change-section",
      { section_id: "sec2" },
      expect.objectContaining({ idempotencyKey: "key-change" }),
    );
    const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty("class_id");
  });

  it("fetchStudentHistory returns the timeline for a student", async () => {
    const { fetchStudentHistory } = await import("../students-service");
    const events = [{ type: "enrollment", id: "e1", date: "2026-04-05", status: "active" }];
    mockGet.mockResolvedValue({ data: events });

    const result = await fetchStudentHistory("s1");

    expect(mockGet).toHaveBeenCalledWith("/students/s1/history");
    expect(result).toEqual(events);
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
