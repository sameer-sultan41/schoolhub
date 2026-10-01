import { buildStudentInput, EMPTY_DEFAULTS, UNSET_VALUE } from "../student-form-schema";

describe("buildStudentInput", () => {
  it("create mode: omits every blank optional field and the address entirely", () => {
    const result = buildStudentInput(EMPTY_DEFAULTS, "create");

    expect(result.preferredName).toBeUndefined();
    expect(result.bloodGroup).toBeUndefined();
    expect(result.nationality).toBeUndefined();
    expect(result.religion).toBeUndefined();
    expect(result.previousSchool).toBeUndefined();
    expect(result.medicalNotes).toBeUndefined();
    expect(result.photoFileId).toBeUndefined();
    expect(result.houseId).toBeUndefined();
    expect(result.address).toBeUndefined();
  });

  it("edit mode: sends null (not omitted) for every blank optional field and the address", () => {
    const result = buildStudentInput(EMPTY_DEFAULTS, "edit");

    expect(result.preferredName).toBeNull();
    expect(result.bloodGroup).toBeNull();
    expect(result.nationality).toBeNull();
    expect(result.religion).toBeNull();
    expect(result.previousSchool).toBeNull();
    expect(result.medicalNotes).toBeNull();
    expect(result.houseId).toBeNull();
    expect(result.address).toBeNull();
  });

  it("edit mode: a blank photo_file_id still comes out undefined, not null", () => {
    // Distinct from every other clearable field: `photoFileId` passes `clearable(...)`
    // through one more `|| undefined`, so edit mode's `null` collapses to `undefined`
    // here specifically — this field is never explicitly nulled out through the form,
    // only replaced by a new upload.
    const result = buildStudentInput(EMPTY_DEFAULTS, "edit");

    expect(result.photoFileId).toBeUndefined();
  });

  it("passes a filled house_id through unchanged in both modes", () => {
    const values = { ...EMPTY_DEFAULTS, house_id: "house-1" };

    expect(buildStudentInput(values, "create").houseId).toBe("house-1");
    expect(buildStudentInput(values, "edit").houseId).toBe("house-1");
  });

  it("treats the UNSET_VALUE sentinel as a blank house selection", () => {
    const values = { ...EMPTY_DEFAULTS, house_id: UNSET_VALUE };

    expect(buildStudentInput(values, "create").houseId).toBeUndefined();
    expect(buildStudentInput(values, "edit").houseId).toBeNull();
  });

  it("builds the address object only once at least one sub-field is filled, in both modes", () => {
    const values = { ...EMPTY_DEFAULTS, address_city: "Lahore" };

    expect(buildStudentInput(values, "create").address).toEqual({ city: "Lahore" });
    expect(buildStudentInput(values, "edit").address).toEqual({ city: "Lahore" });
  });

  it("drops a whitespace-only address sub-field the same as a blank one", () => {
    const values = { ...EMPTY_DEFAULTS, address_city: "   " };

    expect(buildStudentInput(values, "create").address).toBeUndefined();
    expect(buildStudentInput(values, "edit").address).toBeNull();
  });
});
