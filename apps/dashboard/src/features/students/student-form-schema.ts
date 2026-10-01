import { z } from "zod";
import { GENDER_VALUES } from "@schoolhub/types";
import type { StudentRecord } from "@/services";

export const UNSET_VALUE = "unset";

/** Field names are snake_case, matching the API's own — `error.fieldErrors()` keys map
 * onto these with no re-mapping step. Required fields match `REQUIRED_IMPORT_COLUMNS`
 * (`apps/api/apps/student_management/services.py`). */
export const studentFormSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  preferred_name: z.string().optional(),
  date_of_birth: z.string().min(1),
  gender: z.enum(GENDER_VALUES),
  photo_file_id: z.string().optional(),
  campus_id: z.string().min(1),
  house_id: z.string().optional(),
  admission_date: z.string().min(1),
  blood_group: z.string().optional(),
  nationality: z.string().optional(),
  religion: z.string().optional(),
  previous_school: z.string().optional(),
  medical_notes: z.string().optional(),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  address_postal_code: z.string().optional(),
  address_country: z.string().optional(),
});

export type StudentFormValues = z.infer<typeof studentFormSchema>;

export const EMPTY_DEFAULTS: StudentFormValues = {
  first_name: "",
  last_name: "",
  preferred_name: "",
  date_of_birth: "",
  gender: "unspecified",
  photo_file_id: "",
  campus_id: "",
  house_id: UNSET_VALUE,
  admission_date: "",
  blood_group: "",
  nationality: "",
  religion: "",
  previous_school: "",
  medical_notes: "",
  address_line1: "",
  address_line2: "",
  address_city: "",
  address_state: "",
  address_postal_code: "",
  address_country: "",
};

export function detailToFormValues(record: StudentRecord): StudentFormValues {
  const address = (record.address ?? {}) as Record<string, string | undefined>;
  return {
    first_name: record.first_name,
    last_name: record.last_name,
    preferred_name: record.preferred_name ?? "",
    date_of_birth: record.date_of_birth,
    gender: record.gender,
    photo_file_id: record.photo_file_id ?? "",
    campus_id: record.campus_id,
    house_id: record.house_id ?? UNSET_VALUE,
    admission_date: record.admission_date,
    blood_group: record.blood_group ?? "",
    nationality: record.nationality ?? "",
    religion: record.religion ?? "",
    previous_school: record.previous_school ?? "",
    medical_notes: record.medical_notes ?? "",
    address_line1: address.line1 ?? "",
    address_line2: address.line2 ?? "",
    address_city: address.city ?? "",
    address_state: address.state ?? "",
    address_postal_code: address.postal_code ?? "",
    address_country: address.country ?? "",
  };
}

/**
 * Drops every blank address sub-field and sends `undefined` (not an object of empty
 * strings) when none are filled — mirrors `staff-form-dialog.tsx`'s own `buildAddress`
 * exactly, including the same bug it avoids: a naive "always send the address object"
 * would store `{"line1":"",...}` for every student saved with no address at all.
 */
function buildAddress(values: StudentFormValues): Record<string, unknown> | undefined {
  const entries = Object.entries({
    line1: values.address_line1,
    line2: values.address_line2,
    city: values.address_city,
    state: values.address_state,
    postal_code: values.address_postal_code,
    country: values.address_country,
  }).filter(([, value]) => typeof value === "string" && value.trim() !== "");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * `mode` decides clearing semantics: on create, an empty optional field is omitted
 * (nothing to clear); on edit, an emptied field sends `null` — uniformly, for every
 * clearable field including text ones, even though the model also accepts `""` for
 * those (`null=True, blank=True`) — `null` avoids a mixed NULL/"" representation for
 * the same "empty" fact across rows created different ways. `address` is recomputed
 * from the form's current values on every submit rather than dirty-tracked — simpler,
 * and consistent with every other field here, none of which are dirty-tracked either;
 * an edit that leaves the address untouched just resends its own unchanged values,
 * which is a harmless no-op PATCH, not a bug (an earlier draft tried to dirty-track
 * only the address block and got it wrong — the tracking flag was never set true,
 * silently dropping every real address edit; removing the special-case fixed it).
 */
export function buildStudentInput(values: StudentFormValues, mode: "create" | "edit") {
  const clearable = (value: string) => (mode === "edit" ? value || null : value || undefined);
  return {
    firstName: values.first_name,
    lastName: values.last_name,
    dateOfBirth: values.date_of_birth,
    gender: values.gender,
    campusId: values.campus_id,
    admissionDate: values.admission_date,
    preferredName: clearable(values.preferred_name ?? ""),
    houseId:
      values.house_id === UNSET_VALUE || !values.house_id
        ? mode === "edit"
          ? null
          : undefined
        : values.house_id,
    photoFileId: clearable(values.photo_file_id ?? "") || undefined,
    bloodGroup: clearable(values.blood_group ?? ""),
    nationality: clearable(values.nationality ?? ""),
    religion: clearable(values.religion ?? ""),
    previousSchool: clearable(values.previous_school ?? ""),
    medicalNotes: clearable(values.medical_notes ?? ""),
    // On edit, an address emptied down to nothing must clear the stored column, not
    // silently leave it as-is: `buildAddress` returning `undefined` means "send
    // nothing" everywhere else in this function, but here specifically it must mean
    // "send null" once every sub-field is blank (round-4 review finding: the field is
    // nullable, `updateStudent` drops an `undefined` value, so a fully-cleared address
    // would otherwise never reach the server).
    address: mode === "edit" ? (buildAddress(values) ?? null) : buildAddress(values),
  };
}
