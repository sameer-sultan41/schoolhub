import { render, screen } from "@testing-library/react";
import { TenantTheme } from "./tenant-theme";

describe("TenantTheme", () => {
  it("applies tenant branding as CSS variables on the wrapper", () => {
    render(
      <TenantTheme branding={{ primary_color: "#0f766e", radius: "0.75rem" }}>
        <span>content</span>
      </TenantTheme>,
    );

    const wrapper = screen.getByText("content").parentElement;
    expect(wrapper).toHaveStyle({ "--sh-color-primary": "#0f766e" });
    expect(wrapper).toHaveStyle({ "--sh-radius": "0.75rem" });
  });

  it("renders children unstyled when there is no branding", () => {
    render(
      <TenantTheme branding={null}>
        <span>content</span>
      </TenantTheme>,
    );

    expect(screen.getByText("content")).toBeInTheDocument();
  });
});
