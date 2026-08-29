import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * A tenant's public site. Unlike the dashboard this renders on the server, so its data
 * cannot be stubbed from the browser — see `MockApi`. Specs here cover only what the
 * renderer decides without the API: host resolution and the unknown-host fallback.
 */
export class PublicSitePage extends BasePage {
  readonly path = "/";

  /** Generic landing page shown when the Host header matches no tenant. */
  get platformFallback(): Locator {
    return this.page.getByText("No school website is configured for this address.");
  }

  get notFound(): Locator {
    return this.page.getByRole("heading", { name: "Page not found" });
  }
}
