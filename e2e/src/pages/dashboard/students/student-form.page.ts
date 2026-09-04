import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/students/new` — see `apps/dashboard/src/features/students/student-form.tsx`.
 *
 * Locators go through accessible names from `apps/dashboard/messages/en.json`'s
 * `students.*` namespace, not CSS/`data-testid`, same convention as every other page
 * object here.
 *
 * `getByRole`, not `getByLabel`, throughout — same reasoning as `login.page.ts`:
 * `FormLabel required` renders the asterisk as an `aria-hidden` sibling of the label
 * text ("Date of birth" + hidden "*"). `getByRole`'s accessible-name computation
 * correctly excludes `aria-hidden` content; `getByLabel`'s text match does not, so
 * `getByLabel("Date of birth", { exact: true })` matches nothing — confirmed against the
 * real page's accessibility tree, not assumed. `gender`/`campus`/`house` are
 * `SelectTrigger`s with an explicit `aria-label`, matched by `getByRole("combobox")` for
 * the same "role over label" reason, not because of this particular asterisk quirk.
 */
export class StudentFormPage extends BasePage {
  readonly path = "/students/new";

  get firstName(): Locator {
    return this.page.getByRole("textbox", { name: "First name", exact: true });
  }

  get lastName(): Locator {
    return this.page.getByRole("textbox", { name: "Last name", exact: true });
  }

  get dateOfBirth(): Locator {
    return this.page.getByRole("textbox", { name: "Date of birth", exact: true });
  }

  get admissionDate(): Locator {
    return this.page.getByRole("textbox", { name: "Admission date", exact: true });
  }

  get campus(): Locator {
    return this.page.getByRole("combobox", { name: "Campus", exact: true });
  }

  get submit(): Locator {
    return this.page.getByRole("button", { name: "New student", exact: true });
  }

  /** The admission number is server-generated and shown nowhere else on this form. */
  async fillRequired(values: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    admissionDate: string;
    campusName: string;
  }): Promise<void> {
    await this.firstName.fill(values.firstName);
    await this.lastName.fill(values.lastName);
    await this.dateOfBirth.fill(values.dateOfBirth);
    await this.admissionDate.fill(values.admissionDate);
    // `useCampuses()` resolves after first paint and re-renders this trigger, which can
    // detach a click already in flight — Playwright's own actionability retry handles
    // that, but needs longer than the suite's default 10s action timeout here.
    await this.campus.click({ timeout: 20_000 });
    await this.page.getByRole("option", { name: values.campusName }).click();
  }
}
