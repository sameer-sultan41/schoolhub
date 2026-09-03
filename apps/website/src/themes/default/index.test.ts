import { defaultTheme } from "./index";

describe("defaultTheme", () => {
  it("registers every v1 section type", () => {
    expect(Object.keys(defaultTheme.sections).sort()).toEqual(
      [
        "hero",
        "about_school",
        "principal_message",
        "departments_grid",
        "teachers_grid",
        "classes_list",
        "admissions_cta",
        "events_list",
        "news_list",
        "notice_board",
        "gallery",
        "contact_form",
      ].sort(),
    );
  });

  it("provides Navigation and Footer chrome", () => {
    expect(defaultTheme.Navigation).toBeDefined();
    expect(defaultTheme.Footer).toBeDefined();
  });

  it("is named 'default'", () => {
    expect(defaultTheme.name).toBe("default");
  });
});
