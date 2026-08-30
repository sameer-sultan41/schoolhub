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
}
