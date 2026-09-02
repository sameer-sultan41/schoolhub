import { render, screen } from "@testing-library/react";
import AuthLayout from "./layout";

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) => ({ name: "SchoolHub", tagline: "School management, one place" })[key],
    ),
}));

describe("AuthLayout", () => {
  it("renders its children", async () => {
    const ui = await AuthLayout({ children: <span>login form</span> });
    render(ui);

    expect(screen.getByText("login form")).toBeInTheDocument();
  });

  it("scopes the platform brand style to its wrapper only", async () => {
    const ui = await AuthLayout({ children: <span>login form</span> });
    const { container } = render(ui);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.getPropertyValue("--sh-color-primary")).toBe(
      "var(--sh-platform-color-primary)",
    );
  });
});
