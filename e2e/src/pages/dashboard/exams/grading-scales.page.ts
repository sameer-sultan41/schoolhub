import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams/grading-scales` — the scales list (name, type, band count, the Default badge) with each
 * row's "Bands of {scale}", "Make {scale} the default", "Edit {scale}" and "Remove {scale}", the
 * toolbar's "New grading scale", and the band editor dialog. See
 * `apps/dashboard/src/features/exams/grading-scales/`.
 */
export class GradingScalesPage extends BasePage {
  readonly path = "/exams/grading-scales";

  /** Named by its caption, so the band editor's own table never matches. */
  get table(): Locator {
    return this.page.getByRole("table", { name: "Grading scales", exact: true });
  }

  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get createButton(): Locator {
    return this.page.getByRole("button", { name: "New grading scale", exact: true });
  }

  bandsButton(name: string): Locator {
    return this.page.getByRole("button", { name: `Bands of ${name}`, exact: true });
  }

  makeDefaultButton(name: string): Locator {
    return this.page.getByRole("button", { name: `Make ${name} the default`, exact: true });
  }

  rowAction(name: string, action: "Edit" | "Remove"): Locator {
    return this.page.getByRole("button", { name: `${action} ${name}`, exact: true });
  }

  /** The band editor, titled "Bands of {scale}". */
  bandsDialog(name: string): Locator {
    return this.page.getByRole("dialog", { name: `Bands of ${name}` });
  }
}
