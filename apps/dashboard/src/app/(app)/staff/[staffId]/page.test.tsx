import { render, screen } from "@testing-library/react";
import StaffMemberPage from "./page";

jest.mock("@/features/staff/staff-detail", () => ({
  StaffDetail: ({ staffId }: { staffId: string }) => (
    <div data-testid="staff-detail" data-staff-id={staffId} />
  ),
}));

describe("StaffMemberPage", () => {
  it("resolves the staffId param and passes it to the detail view", async () => {
    const ui = await StaffMemberPage({ params: Promise.resolve({ staffId: "st-1" }) });
    render(ui);

    const detail = screen.getByTestId("staff-detail");
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveAttribute("data-staff-id", "st-1");
  });

  it("sets a static page title via metadata (no access token on the server to fetch the name)", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Staff");
  });
});
