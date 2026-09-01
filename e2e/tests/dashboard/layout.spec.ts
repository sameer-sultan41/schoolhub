import { LOCALE_COOKIE_NAME } from "@/constants";
import { env } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * Sidebar's `side="start"` (packages/ui/src/components/sidebar.tsx) is only actually
 * RTL-safe if it resolves to the correct PHYSICAL edge under `dir="rtl"` — the logical
 * CSS conversion this relies on (`start-*`/`end-*`, `ltr:`/`rtl:` variants, no
 * `left`/`right`) was reasoned through, not rendered, when it was written. This
 * renders the real app under `ur` and asserts the rendered position, not the class names.
 */
test.describe("sidebar direction", () => {
  test("renders on the leading (left) screen edge under the default ltr locale", async ({
    page,
    dashboardPage,
    signedIn: _signedIn,
  }) => {
    await dashboardPage.goto();

    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    const box = await dashboardPage.nav.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x).toBeLessThan(50);
  });

  test("renders on the leading (right) screen edge under the ur (rtl) locale", async ({
    page,
    dashboardPage,
    signedIn: _signedIn,
  }) => {
    // Written before dashboardPage.goto(): the locale must be known when the server
    // renders <html dir>, not patched in afterward.
    await page
      .context()
      .addCookies([{ name: LOCALE_COOKIE_NAME, value: "ur", url: env.DASHBOARD_URL }]);

    await dashboardPage.goto();

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // Not dashboardPage.nav: that locator hardcodes the English accessible name, and the
    // nav's name is itself translated under ur (confirmed against the real accessibility
    // tree — the correct Urdu translation of "Primary navigation") — exactly what a real
    // RTL user gets, and exactly why this asserts by role alone rather than switching to
    // a second, ur-specific locator.
    const nav = page.getByRole("navigation");
    await expect(nav).toBeVisible();
    const box = await nav.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.x + box.width).toBeGreaterThan(viewport.width - 50);
    }
  });
});
