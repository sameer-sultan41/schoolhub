import type { Locator, Page } from "@playwright/test";

/**
 * Base for every page object.
 *
 * Page objects own *locators and navigation only* — never assertions. Keeping
 * `expect` in the spec is what makes a failure report name the behaviour that broke
 * rather than a helper deep in this directory (Playwright best practices, "Test
 * user-visible behavior").
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** Route this page lives at, relative to the project's `baseURL`. */
  abstract readonly path: string;

  async goto(options: { path?: string } = {}): Promise<void> {
    await this.page.goto(options.path ?? this.path);
  }

  /** The `role="alert"` region the app renders API errors into. */
  get alert(): Locator {
    return this.page.getByRole("alert");
  }

  get heading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }
}
