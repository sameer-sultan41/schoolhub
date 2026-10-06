import { id } from "@/data/factories";
import { fail, noContent, ok, paginated } from "../envelope";
import type { MockModule } from "../router";

export interface EmergencyContact {
  id: string;
  student_id: string;
  name: string;
  relationship: string;
  phone: string;
  alt_phone: string | null;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentDocument {
  id: string;
  student_id: string;
  file_id: string;
  document_type: string;
  title: string;
  notes: string | null;
  verification_status: "pending" | "verified" | "rejected";
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function buildEmergencyContact(overrides: Partial<EmergencyContact> = {}): EmergencyContact {
  return {
    id: id("emergency-contact"),
    student_id: "",
    name: "Hamza Raza",
    relationship: "Uncle",
    phone: "0300-0000000",
    alt_phone: null,
    priority: 1,
    notes: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

export function buildStudentDocument(overrides: Partial<StudentDocument> = {}): StudentDocument {
  return {
    id: id("student-document"),
    student_id: "",
    file_id: id("file"),
    document_type: "birth_certificate",
    title: "Birth certificate",
    notes: null,
    verification_status: "pending",
    verified_by: null,
    verified_at: null,
    expires_at: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

export interface StudentRelationsOptions {
  emergencyContacts?: EmergencyContact[];
  documents?: StudentDocument[];
}

export function studentRelationsModule(options: StudentRelationsOptions = {}): MockModule {
  return (api) => {
    const contacts = [...(options.emergencyContacts ?? [])];
    const documents = [...(options.documents ?? [])];

    api.get("/students/:studentId/emergency-contacts", (request) => {
      const rows = contacts
        .filter((c) => c.student_id === request.params["studentId"])
        .sort((a, b) => a.priority - b.priority);
      return paginated(rows);
    });

    api.post("/students/:studentId/emergency-contacts", (request) => {
      const body = (request.json() as Partial<EmergencyContact> | null) ?? {};
      const created = buildEmergencyContact({
        ...body,
        id: id("emergency-contact"),
        student_id: request.params["studentId"] ?? "",
      });
      contacts.push(created);
      return ok(created, { status: 201 });
    });

    api.get("/students/:studentId/documents", (request) => {
      const rows = documents.filter((d) => d.student_id === request.params["studentId"]);
      return paginated(rows);
    });

    api.post("/students/:studentId/documents", (request) => {
      const body = (request.json() as Partial<StudentDocument> | null) ?? {};
      const created = buildStudentDocument({
        ...body,
        id: id("student-document"),
        student_id: request.params["studentId"] ?? "",
      });
      documents.push(created);
      return ok(created, { status: 201 });
    });

    api.delete("/student-documents/:documentId", (request) => {
      const index = documents.findIndex((d) => d.id === request.params["documentId"]);
      if (index === -1) return fail(404, "Not found.");
      documents.splice(index, 1);
      return noContent();
    });

    api.post("/student-documents/:documentAction", (request) => {
      const [documentId, action] = (request.params["documentAction"] ?? "").split(":");
      const match = documents.find((d) => d.id === documentId);
      if (!match) return fail(404, "Not found.");
      if (action === "verify") {
        const decision = (request.json() as { decision: "verified" | "rejected" } | null)?.decision;
        if (decision) match.verification_status = decision;
        return ok(match);
      }
      if (action === "download") {
        // Task 1's own `students.document.view`-gated `:download` action — a dedicated
        // path on this resource, NOT the generic `/files/{id}:download` `jobsModule`
        // owns. `Services.students.getDocumentDownloadUrl` calls this one specifically.
        return ok({ download_url: `https://files.example.test/download/${documentId}` });
      }
      return fail(404, "Not found.");
    });
  };
}
