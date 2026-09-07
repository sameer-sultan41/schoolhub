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

test.describe("keyboard shortcut", () => {
  test("Ctrl+B collapses the desktop sidebar and a second press restores it", async ({
    page,
    dashboardPage,
    signedIn: _signedIn,
  }) => {
    await dashboardPage.goto();

    const nav = dashboardPage.nav;
    const openBox = await nav.boundingBox();
    expect(openBox).not.toBeNull();
    const openWidth = openBox?.width ?? 0;

    // WIDTH, not x. Collapsing used to translate the whole sidebar off-canvas, and this
    // test read its x position because that was the only thing that moved. Collapse mode
    // is a layout preference now and defaults to `icon`, which keeps the rail on screen
    // at x=0 and narrows it to `--sidebar-width-icon` instead — so the old assertion
    // failed against a sidebar that was collapsing perfectly well. Width is what changes
    // under either mode.
    await page.keyboard.press("Control+b");
    await expect.poll(async () => (await nav.boundingBox())?.width).toBeLessThan(openWidth / 2);

    // The regression this test exists for: SidebarProvider's own toggleSidebar/setOpen
    // were plain (non-memoised) functions, so the keydown listener — attached once, its
    // effect keyed on [isMobile] rather than [toggleSidebar] — kept calling the FIRST
    // render's stale closure forever. That closure always recomputed !<the original
    // open value>, so every press after the first tried to set state to the same value
    // it already held and React silently dropped it: the sidebar collapsed once and
    // then never came back.
    await page.keyboard.press("Control+b");
    await expect.poll(async () => (await nav.boundingBox())?.width).toBeGreaterThan(openWidth - 10);
  });
});

test.describe("mobile navigation drawer", () => {
  test("opens via the trigger, shows the nav, and closes on link click", async ({
    page,
    dashboardPage,
    signedIn: _signedIn,
  }) => {
    await page.setViewportSize({ width: 500, height: 800 });
    await dashboardPage.goto();

    // Below the breakpoint, Sidebar's own isMobile check swaps to the Sheet-based render
    // entirely — the desktop nav isn't in the tree at all, only the trigger is.
    await expect(page.getByRole("navigation")).toHaveCount(0);

    await page.getByRole("button", { name: "Primary navigation" }).click();

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav).toBeVisible();
    const studentsLink = nav.getByRole("link", { name: "Dashboard" });
    await expect(studentsLink).toBeVisible();

    await studentsLink.click();

    await expect(page).toHaveURL(/\/dashboard/);
    // The drawer must not survive a client-side route change — SidebarProvider's mobile
    // state has no navigation-aware close of its own; this only holds if the app wires it.
    await expect(nav).toHaveCount(0);
  });
});
