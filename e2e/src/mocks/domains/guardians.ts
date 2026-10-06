import { id } from "@/data/factories";
import { fail, ok, paginated } from "../envelope";
import type { MockModule } from "../router";

export interface Guardian {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  occupation: string | null;
  employer: string | null;
  national_id: string | null;
  photo_file_id: string | null;
  // Mirrors Task 1's new `GuardianSerializer.photo_url` field — kept here so this mock's
  // `Guardian` shape matches the real generated `ApiSchemas["Guardian"]`.
  photo_url: string | null;
  address: Record<string, unknown> | null;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface StudentGuardianLink {
  id: string;
  student_id: string;
  guardian_id: string;
  relationship: "father" | "mother" | "grandparent" | "sibling" | "legal_guardian" | "other";
  is_primary: boolean;
  is_fee_responsible: boolean;
  can_pick_up: boolean;
  receives_communications: boolean;
  has_portal_access: boolean;
  access_revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function buildGuardian(overrides: Partial<Guardian> = {}): Guardian {
  return {
    id: id("guardian"),
    user_id: null,
    first_name: "Ayesha",
    last_name: "Raza",
    phone: "0300-0000000",
    alt_phone: null,
    email: null,
    occupation: null,
    employer: null,
    national_id: null,
    photo_file_id: null,
    photo_url: null,
    address: null,
    custom_fields: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

export function buildGuardianLink(
  overrides: Partial<StudentGuardianLink> = {},
): StudentGuardianLink {
  return {
    id: id("student-guardian"),
    student_id: "",
    guardian_id: "",
    relationship: "father",
    is_primary: false,
    is_fee_responsible: false,
    can_pick_up: true,
    receives_communications: true,
    has_portal_access: true,
    access_revoked_reason: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

export interface GuardiansOptions {
  guardians?: Guardian[];
  links?: StudentGuardianLink[];
}

export function guardiansModule(options: GuardiansOptions = {}): MockModule {
  return (api) => {
    const guardians = [...(options.guardians ?? [])];
    const links = [...(options.links ?? [])];

    api.get("/guardians", (request) => {
      const search = request.searchParams.get("search")?.toLowerCase();
      const matching = guardians.filter(
        (g) =>
          !search ||
          `${g.first_name} ${g.last_name}`.toLowerCase().includes(search) ||
          g.phone.includes(search),
      );
      return paginated(matching);
    });

    api.get("/guardians/:guardianId", (request) => {
      const match = guardians.find((g) => g.id === request.params["guardianId"]);
      return match ? ok(match) : fail(404, "Not found.");
    });

    api.post("/guardians", (request) => {
      const body = (request.json() as Partial<Guardian> | null) ?? {};
      const created = buildGuardian({ ...body, id: id("guardian") });
      guardians.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/guardians/:guardianId", (request) => {
      const match = guardians.find((g) => g.id === request.params["guardianId"]);
      if (!match) return fail(404, "Not found.");
      Object.assign(match, (request.json() as Partial<Guardian> | null) ?? {});
      return ok(match);
    });

    api.get("/students/:studentId/guardians", (request) => {
      const studentLinks = links.filter((l) => l.student_id === request.params["studentId"]);
      return paginated(studentLinks);
    });

    api.post("/students/:studentId/guardians", (request) => {
      const body = (request.json() as Partial<StudentGuardianLink> | null) ?? {};
      const alreadyLinked = links.some(
        (l) => l.student_id === request.params["studentId"] && l.guardian_id === body.guardian_id,
      );
      if (alreadyLinked) {
        // The real shape: `StudentGuardian`'s `UniqueConstraint` -> `IntegrityError` ->
        // `core/api/exceptions.py`'s 409 `conflict` mapping — not an invented 422.
        // `fail`'s default code for 409 is already `"conflict"` (`CODE_BY_STATUS`).
        return fail(409, "The request conflicts with existing data.", {
          details: [{ field: "non_field", issue: "The request conflicts with existing data." }],
        });
      }
      const created = buildGuardianLink({
        ...body,
        id: id("student-guardian"),
        student_id: request.params["studentId"] ?? "",
      });
      links.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/student-guardians/:linkId", (request) => {
      const match = links.find((l) => l.id === request.params["linkId"]);
      if (!match) return fail(404, "Not found.");
      const body = (request.json() as Partial<StudentGuardianLink> | null) ?? {};
      if (body.is_primary) {
        for (const link of links) {
          if (link.student_id === match.student_id) link.is_primary = false;
        }
      }
      Object.assign(match, body);
      return ok(match);
    });
  };
}
