import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PREFERENCE_DEFAULTS } from "../preferences-config";
import { PreferencesProvider, usePreference, usePreferenceActions } from "../preferences-provider";

jest.mock("../preferences-cookies.client", () => ({ writePreferenceCookie: jest.fn() }));

function Consumer() {
  const sidebarVariant = usePreference("sidebar_variant");
  const { setPreference, resetPreferences } = usePreferenceActions();

  return (
    <div>
      <span>{sidebarVariant}</span>
      <button
        onClick={() => {
          setPreference("sidebar_variant", "floating");
        }}
      >
        Float it
      </button>
      <button onClick={resetPreferences}>Reset</button>
    </div>
  );
}

describe("PreferencesProvider", () => {
  it("seeds the store from initialValues and lets a consumer read and change it", async () => {
    const user = userEvent.setup();
    render(
      <PreferencesProvider initialValues={PREFERENCE_DEFAULTS}>
        <Consumer />
      </PreferencesProvider>,
    );

    expect(screen.getByText(PREFERENCE_DEFAULTS.sidebar_variant)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Float it" }));
    expect(screen.getByText("floating")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText(PREFERENCE_DEFAULTS.sidebar_variant)).toBeInTheDocument();
  });

  it("usePreference throws outside a PreferencesProvider — a screen can't silently read no preferences", () => {
    // React logs this expected throw to the console during the render attempt; keep the
    // test's own output clean.
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Consumer />)).toThrow(
      "usePreference must be used inside <PreferencesProvider>.",
    );

    consoleError.mockRestore();
  });
});
