import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme, resetTheme } from "@/test-utils";
import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  afterEach(() => {
    // next-themes persists to localStorage and stamps a class on <html>; neither is reset
    // by jest's clearMocks, so without this the first test to pick dark decides the theme
    // for every test after it.
    resetTheme();
  });

  it("offers light, dark and match-system", async () => {
    renderWithTheme(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: "Change theme" }));

    expect(screen.getByRole("menuitemradio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Match system" })).toBeInTheDocument();
  });

  it("marks the active theme as checked", async () => {
    renderWithTheme(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: "Change theme" }));

    expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("puts the chosen theme on the document element", async () => {
    renderWithTheme(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: "Change theme" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));

    // The class, not a data attribute: packages/ui's `dark` variant matches `.dark`, and
    // an attribute-based provider would leave every dark: utility inert.
    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
    });
  });

  it("names itself for assistive tech rather than relying on the icon", () => {
    renderWithTheme(<ThemeToggle />);

    const trigger = screen.getByRole("button", { name: "Change theme" });
    expect(trigger).toBeInTheDocument();
    // The icon must contribute nothing to the accessible name — the label is the only
    // thing a screen reader has to go on here.
    expect(trigger.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
