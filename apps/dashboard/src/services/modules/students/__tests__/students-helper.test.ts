import type { StudentRecord } from "@/services";
import { toStudentRow } from "../students-helper";

function studentRecord(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: "stu-1",
    admission_number: "2026-0050",
    first_name: "Aisha",
    last_name: "Khan",
    preferred_name: null,
    date_of_birth: "2015-03-12",
    gender: "female",
    photo_file_id: null,
    photo_url: null,
    campus_id: "campus-1",
    campus_name: "Main Campus",
    house_id: null,
    house_name: null,
    status: "active",
    admission_date: "2026-01-10",
    blood_group: null,
    nationality: null,
    religion: null,
    previous_school: null,
    medical_notes: null,
    address: null,
    custom_fields: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

describe("toStudentRow", () => {
  it("falls back to an empty string when admission_number is absent", () => {
    const { admission_number: _omit, ...withoutAdmissionNumber } = studentRecord();

    const row = toStudentRow(withoutAdmissionNumber);

    expect(row.admissionNumber).toBe("");
  });

  it("normalizes a null photo_url to undefined rather than passing null through", () => {
    const row = toStudentRow(studentRecord({ photo_url: null }));

    expect(row.signedPhotoUrl).toBeUndefined();
  });

  it("carries a real photo_url through as the signed URL", () => {
    const row = toStudentRow(
      studentRecord({ photo_url: "https://files.example.com/students/stu-1/photo.jpg?sig=abc" }),
    );

    expect(row.signedPhotoUrl).toBe("https://files.example.com/students/stu-1/photo.jpg?sig=abc");
  });
});
