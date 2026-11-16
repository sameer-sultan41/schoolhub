import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * A tenant's public site. Unlike the dashboard this renders on the server, so its data
 * cannot be stubbed from the browser — see `MockApi`. The mocked lane pairs with
 * `scripts/tenant-lookup-stub.mjs`, which answers every host lookup as unknown, so
 * specs here cover only the unknown-host fallback.
 */
export class PublicSitePage extends BasePage {
  readonly path = "/";

  /**
   * Generic landing page shown when the Host header matches no tenant.
   *
   * Route is `/platform-landing`, not `/_platform`: an underscore-prefixed segment is a
   * Next.js private folder, excluded from routing — the app served its generic 404 for
   * every unresolvable host until this was found and fixed (apps/website/src/proxy.ts).
   */
  get platformFallback(): Locator {
    return this.page.getByText("No school website is configured for this address.");
  }

  get notFound(): Locator {
    return this.page.getByRole("heading", { name: "Page not found" });
  }

  /** A section's heading (`h2`): the about and contact sections title themselves with one. */
  sectionHeading(name: string): Locator {
    return this.page.getByRole("heading", { level: 2, name, exact: true });
  }

  /** The contact form section's fields (`PublicEnquiryForm`). */
  get contactName(): Locator {
    return this.page.getByLabel("Your name", { exact: true });
  }

  get contactEmail(): Locator {
    return this.page.getByLabel("Email", { exact: true });
  }

  get contactMessage(): Locator {
    return this.page.getByLabel("Message", { exact: true });
  }

  get sendMessage(): Locator {
    return this.page.getByRole("button", { name: "Send message", exact: true });
  }

  /** Shown only once the API has accepted the submission (`response.ok`). */
  get contactSent(): Locator {
    return this.page.getByText("Thank you — we have received your message and will be in touch.");
  }

  /** A link in the page's content, by its exact text (a news list item, say). */
  link(name: string): Locator {
    return this.page.getByRole("link", { name, exact: true });
  }

  /** An image, by its exact alt text. */
  image(name: string): Locator {
    return this.page.getByRole("img", { name, exact: true });
  }
}
