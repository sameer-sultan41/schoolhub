import { defaultTheme } from "../index";

describe("defaultTheme", () => {
  it("renders every v1 section type", () => {
    const rendered = Object.entries(defaultTheme.sections)
      .filter(([, component]) => component !== null)
      .map(([type]) => type);
    expect(rendered.sort()).toEqual(
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

  it("declares the API's newer types without rendering them yet", () => {
    expect(defaultTheme.sections.rich_text).toBeNull();
    expect(defaultTheme.sections.faq).toBeNull();
  });

  it("provides Navigation and Footer chrome", () => {
    expect(defaultTheme.Navigation).toBeDefined();
    expect(defaultTheme.Footer).toBeDefined();
  });

  it("is named 'default'", () => {
    expect(defaultTheme.name).toBe("default");
  });
});
