import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { StudentDirectoryFilters } from "../student-directory-filters";

jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([]) },
    schoolOrganization: {
      fetchHouses: jest.fn().mockResolvedValue([]),
      fetchClasses: jest.fn(),
      fetchSections: jest.fn(),
      fetchAcademicSessions: jest.fn(),
    },
  },
}));

const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;
const mockFetchAcademicSessions = Services.schoolOrganization
  .fetchAcademicSessions as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchAcademicSessions
>;

function baseProps() {
  return {
    searchInput: "",
    onSearchInputChange: jest.fn(),
    statusFilter: "all",
    onStatusFilterChange: jest.fn(),
    campusId: "",
    onCampusIdChange: jest.fn(),
    houseId: "",
    onHouseIdChange: jest.fn(),
    academicSessionId: "",
    onAcademicSessionIdChange: jest.fn(),
    classId: "",
    onClassIdChange: jest.fn(),
    sectionId: "",
    onSectionIdChange: jest.fn(),
  };
}

describe("StudentDirectoryFilters — academic session/class/section", () => {
  beforeEach(() => {
    mockFetchClasses.mockReset();
    mockFetchSections.mockReset();
    mockFetchAcademicSessions.mockReset();
    mockFetchClasses.mockResolvedValue([
      { id: "class-1", name: "Grade 1" },
      { id: "class-2", name: "Grade 2 (inactive)" },
    ]);
    mockFetchSections.mockResolvedValue([{ id: "section-1", name: "A" }]);
    mockFetchAcademicSessions.mockResolvedValue([
      { id: "sess-1", name: "2026-27", status: "active", is_current: true },
      { id: "sess-closed", name: "2024-25", status: "closed", is_current: false },
    ]);
  });

  it("fetches classes/sessions with no isActive param — shows every option regardless of status", async () => {
    renderWithProviders(<StudentDirectoryFilters {...baseProps()} />);

    expect(mockFetchClasses).toHaveBeenCalledWith();

    await userEvent.click(screen.getByRole("combobox", { name: /academic session/i }));
    // Unlike the enroll picker, a closed session still appears here — the directory
    // filter's whole purpose is historical lookup.
    expect(await screen.findByRole("option", { name: "2024-25" })).toBeInTheDocument();
  });

  it("cascades section options to the chosen class, with no isActive/campus_id param", async () => {
    renderWithProviders(<StudentDirectoryFilters {...baseProps()} />);

    await userEvent.click(screen.getByRole("combobox", { name: /^class$/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Grade 1" }));

    expect(mockFetchSections).toHaveBeenCalledWith({ classId: "class-1" });
  });

  it("clears the chosen section when the class changes", async () => {
    const onSectionIdChange = jest.fn();
    renderWithProviders(
      <StudentDirectoryFilters {...baseProps()} onSectionIdChange={onSectionIdChange} />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: /^class$/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Grade 1" }));

    expect(onSectionIdChange).toHaveBeenCalledWith("");
  });

  it("disables the section picker until a class is chosen", () => {
    renderWithProviders(<StudentDirectoryFilters {...baseProps()} />);

    expect(screen.getByRole("combobox", { name: /^section$/i })).toBeDisabled();
  });
});
