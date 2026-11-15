import {
  brandingOf,
  buildSchoolProfileBody,
  settingsToProfileValues,
} from "../school-settings-helper";
import { LOGO_FILE_ID, schoolSettingsRecord } from "./school-settings-fixtures";

describe("school-settings helpers", () => {
  it("reads the stored colour into the form, and an unknown locale as the default", () => {
    expect(settingsToProfileValues(schoolSettingsRecord({ locale: "fr" }))).toEqual({
      name: "City School",
      logo_file_id: "",
      primary_color: "#1E88E5",
      timezone: "Asia/Karachi",
      locale: "en",
      currency: "PKR",
    });
  });

  it("treats a branding that is not an object as empty", () => {
    expect(brandingOf({ branding: null })).toEqual({});
    expect(settingsToProfileValues(schoolSettingsRecord({ branding: "x" })).primary_color).toBe("");
  });

  it("sends the colour alone under branding, and leaves an unchanged logo out", () => {
    const record = schoolSettingsRecord({ logo_file_id: LOGO_FILE_ID });
    const values = { ...settingsToProfileValues(record), currency: "pkr", primary_color: "" };

    expect(buildSchoolProfileBody(values, record)).toEqual({
      name: "City School",
      branding: { primary_color: null },
      timezone: "Asia/Karachi",
      locale: "en",
      currency: "PKR",
    });
  });

  it("sends a new logo, and null when the logo is removed", () => {
    const record = schoolSettingsRecord({ logo_file_id: LOGO_FILE_ID });
    const values = settingsToProfileValues(record);

    expect(buildSchoolProfileBody({ ...values, logo_file_id: "" }, record).logo_file_id).toBeNull();
    expect(
      buildSchoolProfileBody({ ...values, logo_file_id: "new-file" }, schoolSettingsRecord())
        .logo_file_id,
    ).toBe("new-file");
  });
});
