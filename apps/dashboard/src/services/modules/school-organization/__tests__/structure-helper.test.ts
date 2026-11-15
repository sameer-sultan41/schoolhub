import {
  buildCampusInput,
  buildClassInput,
  buildDepartmentInput,
  buildHolidayEntry,
  buildHouseInput,
  buildSectionInput,
  buildSubjectInput,
  defaultCampusFormValues,
  defaultClassFormValues,
  defaultDepartmentFormValues,
  defaultHolidayFormValues,
  defaultHouseFormValues,
  defaultSectionFormValues,
  defaultSubjectFormValues,
  holidayErrorField,
  holidaysByDate,
  holidayToFormValues,
  recordToCampusFormValues,
  recordToClassFormValues,
  recordToDepartmentFormValues,
  recordToHouseFormValues,
  recordToSectionFormValues,
  recordToSubjectFormValues,
  structureStatusToIsActive,
  toStructureQueryParams,
  typeFilterToDepartmentType,
  typeFilterToSubjectType,
  withHoliday,
  withoutHoliday,
} from "../school-organization-helper";
import {
  campusRecord,
  classRecord,
  departmentRecord,
  houseRecord,
  sectionRecord,
  subjectRecord,
} from "./structure-fixtures";

const EID = {
  name: "Spring break",
  start_date: "2027-03-20",
  end_date: "2027-03-22",
  campus_id: null,
};
const SPORTS = {
  name: "Sports day",
  start_date: "2026-12-01",
  end_date: "2026-12-01",
  campus_id: "c",
};

describe("structure helpers", () => {
  it("maps the status and type filters, with all as no filter", () => {
    expect(structureStatusToIsActive("active")).toBe(true);
    expect(structureStatusToIsActive("inactive")).toBe(false);
    expect(structureStatusToIsActive("all")).toBeUndefined();
    expect(typeFilterToDepartmentType("administrative")).toBe("administrative");
    expect(typeFilterToDepartmentType("all")).toBeUndefined();
  });

  it("drops blank query params but keeps a false status", () => {
    expect(toStructureQueryParams({ page: 1, pageSize: 10, search: "", isActive: false })).toEqual({
      page: 1,
      page_size: 10,
      is_active: false,
    });
  });

  it("round-trips a campus, clearing blank optional fields to null", () => {
    expect(buildCampusInput(defaultCampusFormValues())).toEqual({
      name: "",
      code: "",
      phone: null,
      email: null,
      timezone: null,
      is_primary: false,
      is_active: true,
    });
    const values = recordToCampusFormValues(campusRecord({ timezone: "Asia/Karachi" }));
    expect(buildCampusInput({ ...values, name: "  Main  " })).toMatchObject({
      name: "Main",
      timezone: "Asia/Karachi",
      email: "main@cityschool.test",
    });
  });

  it("round-trips a department, a blank campus meaning every campus", () => {
    expect(buildDepartmentInput(defaultDepartmentFormValues())).toMatchObject({
      department_type: "academic",
      campus_id: null,
      description: null,
    });
    const values = recordToDepartmentFormValues(departmentRecord({ campus_id: "c-1" }));
    expect(buildDepartmentInput(values)).toMatchObject({ campus_id: "c-1", code: "SCI" });
  });

  it("round-trips a house", () => {
    expect(buildHouseInput(defaultHouseFormValues())).toEqual({
      name: "",
      code: null,
      color: null,
      motto: null,
      is_active: true,
    });
    expect(buildHouseInput(recordToHouseFormValues(houseRecord()))).toEqual({
      name: "Red House",
      code: "RED",
      color: "#D32F2F",
      motto: "Courage first",
      is_active: true,
    });
  });

  it("round-trips a class, sending its level as a number and a blank code as null", () => {
    expect(buildClassInput(recordToClassFormValues(classRecord()))).toEqual({
      name: "Grade 1",
      code: "G1",
      level: 1,
      is_active: true,
    });
    expect(buildClassInput({ ...defaultClassFormValues(), name: " Grade 2 ", level: "2" })).toEqual(
      { name: "Grade 2", code: null, level: 2, is_active: true },
    );
  });

  it("round-trips a section, a blank capacity meaning unlimited", () => {
    const record = sectionRecord();
    expect(buildSectionInput(recordToSectionFormValues(record))).toEqual({
      class_id: record.class_id,
      campus_id: record.campus_id,
      name: "A",
      capacity: 30,
      is_active: true,
    });
    expect(recordToSectionFormValues(sectionRecord({ capacity: null })).capacity).toBe("");
    expect(defaultSectionFormValues("c-1")).toMatchObject({ class_id: "c-1", capacity: "" });
    expect(
      buildSectionInput({ ...defaultSectionFormValues("c-1"), campus_id: "k-1", name: "B" })
        .capacity,
    ).toBeNull();
  });

  it("round-trips a subject, a blank department meaning none", () => {
    expect(buildSubjectInput(recordToSubjectFormValues(subjectRecord()))).toEqual({
      name: "Mathematics",
      code: "MATH",
      subject_type: "core",
      department_id: subjectRecord().department_id,
      description: null,
      is_active: true,
    });
    expect(
      buildSubjectInput({ ...defaultSubjectFormValues(), name: "Art", code: "ART" }).department_id,
    ).toBeNull();
    expect(typeFilterToSubjectType("all")).toBeUndefined();
    expect(typeFilterToSubjectType("elective")).toBe("elective");
  });

  it("shows a one-day holiday's end as blank and sends it as the start", () => {
    expect(holidayToFormValues(SPORTS)).toEqual({
      name: "Sports day",
      start_date: "2026-12-01",
      end_date: "",
      campus_id: "c",
    });
    expect(holidayToFormValues(EID).end_date).toBe("2027-03-22");
    const oneDay = { ...defaultHolidayFormValues(), name: " Eid ", start_date: "2027-03-20" };
    expect(buildHolidayEntry(oneDay)).toEqual({
      name: "Eid",
      start_date: "2027-03-20",
      end_date: "2027-03-20",
      campus_id: null,
    });
  });

  it("replaces, appends and removes a holiday by its place in the list", () => {
    expect(withHoliday([EID], 0, SPORTS)).toEqual([SPORTS]);
    expect(withHoliday([EID], 1, SPORTS)).toEqual([EID, SPORTS]);
    expect(withoutHoliday([EID, SPORTS], 0)).toEqual([SPORTS]);
  });

  it("orders holidays by date, keeping each one's place in the stored list", () => {
    expect(holidaysByDate([EID, SPORTS])).toEqual([
      { entry: SPORTS, index: 1 },
      { entry: EID, index: 0 },
    ]);
  });

  it("maps only the edited holiday's server errors onto the dialog's inputs", () => {
    const rename = holidayErrorField(2);
    expect(rename("holidays.2.end_date")).toBe("end_date");
    expect(rename("holidays.1.end_date")).toBeUndefined();
    expect(rename("working_days")).toBeUndefined();
  });
});
