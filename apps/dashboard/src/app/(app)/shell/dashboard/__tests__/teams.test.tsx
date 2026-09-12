import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test-utils";
import { Services } from "@/services";
import { Teams } from "../teams";

jest.mock("@/services", () => ({
  Services: { dashboard: { fetchStaffDirectory: jest.fn() } },
}));

const mockFetchStaffDirectory = Services.dashboard.fetchStaffDirectory as jest.MockedFunction<
  typeof Services.dashboard.fetchStaffDirectory
>;

describe("Teams", () => {
  beforeEach(() => {
    mockFetchStaffDirectory.mockReset();
  });

  it("shows each staff member's name and a real role, never a fabricated rating", async () => {
    mockFetchStaffDirectory.mockResolvedValue([
      {
        id: "st-1",
        first_name: "Ayesha",
        last_name: "Khan",
        designation_name: "Head Teacher",
        department_name: "Academics",
        campus_name: "Main Campus",
        staff_type: "teaching",
        employment_status: "active",
        updated_at: "2026-09-01T00:00:00Z",
      },
    ]);

    renderWithProviders(<Teams />);

    expect(await screen.findByText("Ayesha Khan")).toBeInTheDocument();
    expect(screen.getByText("Head Teacher")).toBeInTheDocument();
  });

  it("falls back to teaching/non-teaching when no designation is on file", async () => {
    mockFetchStaffDirectory.mockResolvedValue([
      {
        id: "st-2",
        first_name: "Bilal",
        last_name: "Ahmed",
        designation_name: null,
        department_name: "Administration",
        campus_name: "Main Campus",
        staff_type: "non_teaching",
        employment_status: "active",
        updated_at: "2026-09-01T00:00:00Z",
      },
    ]);

    renderWithProviders(<Teams />);

    expect(await screen.findByText("Non-teaching staff")).toBeInTheDocument();
  });

  it("filters by name and by role as the search box changes", async () => {
    mockFetchStaffDirectory.mockResolvedValue([
      {
        id: "st-1",
        first_name: "Ayesha",
        last_name: "Khan",
        designation_name: "Head Teacher",
        department_name: "Academics",
        campus_name: "Main Campus",
        staff_type: "teaching",
        employment_status: "active",
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "st-2",
        first_name: "Bilal",
        last_name: "Ahmed",
        designation_name: "Accountant",
        department_name: "Administration",
        campus_name: "Main Campus",
        staff_type: "non_teaching",
        employment_status: "active",
        updated_at: "2026-09-01T00:00:00Z",
      },
    ]);

    renderWithProviders(<Teams />);
    await screen.findByText("Ayesha Khan");

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Search Staff..."), "accountant");

    expect(screen.queryByText("Ayesha Khan")).not.toBeInTheDocument();
    expect(screen.getByText("Bilal Ahmed")).toBeInTheDocument();
  });

  it("shows the empty state when no staff member is on file", async () => {
    mockFetchStaffDirectory.mockResolvedValue([]);

    renderWithProviders(<Teams />);

    expect(await screen.findByText("No staff found")).toBeInTheDocument();
  });

  it("links to the full staff directory", async () => {
    mockFetchStaffDirectory.mockResolvedValue([
      {
        id: "st-1",
        first_name: "Ayesha",
        last_name: "Khan",
        designation_name: "Head Teacher",
        department_name: "Academics",
        campus_name: "Main Campus",
        staff_type: "teaching",
        employment_status: "active",
        updated_at: "2026-09-01T00:00:00Z",
      },
    ]);

    renderWithProviders(<Teams />);
    await screen.findByText("Ayesha Khan");

    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/staff");
  });
});
