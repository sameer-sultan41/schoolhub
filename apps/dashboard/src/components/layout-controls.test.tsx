import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../../messages/en.json";
import { PREFERENCE_DEFAULTS } from "@/lib/preferences/preferences-config";
import { PreferencesProvider } from "@/lib/preferences/preferences-provider";
import { LayoutControls } from "./layout-controls";

jest.mock("@/lib/preferences/preferences-cookies.client", () => ({
  writePreferenceCookie: jest.fn(),
}));

function renderControls(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PreferencesProvider initialValues={PREFERENCE_DEFAULTS}>{ui}</PreferencesProvider>
    </NextIntlClientProvider>,
  );
}

describe("LayoutControls", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-sidebar-variant");
    document.documentElement.removeAttribute("data-theme-preset");
  });

  it("picking a sidebar layout applies it to <html> immediately, no Save step", async () => {
    const user = userEvent.setup();
    renderControls(<LayoutControls />);

    await user.click(screen.getByRole("button", { name: "Preferences" }));
    await user.click(await screen.findByRole("button", { name: "Floating" }));

    expect(document.documentElement.getAttribute("data-sidebar-variant")).toBe("floating");
  });

  it("Reset to defaults puts every preference — including one just changed — back", async () => {
    const user = userEvent.setup();
    renderControls(<LayoutControls />);

    await user.click(screen.getByRole("button", { name: "Preferences" }));
    await user.click(await screen.findByRole("button", { name: "Floating" }));
    expect(document.documentElement.getAttribute("data-sidebar-variant")).toBe("floating");

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));

    expect(document.documentElement.getAttribute("data-sidebar-variant")).toBe(
      PREFERENCE_DEFAULTS.sidebar_variant,
    );
  });

  it("the colour-preset picker changes theme_preset via the Select, not the toggle groups", async () => {
    const user = userEvent.setup();
    renderControls(<LayoutControls />);

    await user.click(screen.getByRole("button", { name: "Preferences" }));
    await user.click(await screen.findByRole("combobox", { name: "Colours" }));
    await user.click(await screen.findByRole("option", { name: "School colours" }));

    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("tenant");
  });
});
