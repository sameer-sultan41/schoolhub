import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { getDepartments } from "@/lib/content";
import { DepartmentsGrid } from "./departments-grid";

jest.mock("@/lib/content", () => ({ getDepartments: jest.fn() }));

const mockGetDepartments = getDepartments as jest.MockedFunction<typeof getDepartments>;

describe("DepartmentsGrid", () => {
  beforeEach(() => mockGetDepartments.mockReset());

  it("renders each department", async () => {
    mockGetDepartments.mockResolvedValue([
      { id: "d1", name: "Science", description: "Physics, chemistry, biology" },
    ]);

    render(await DepartmentsGrid({ section: makeSection({}), tenant: makeTenant() }));

    expect(screen.getByText("Science")).toBeInTheDocument();
    expect(screen.getByText("Physics, chemistry, biology")).toBeInTheDocument();
  });

  it("renders an optional intro", async () => {
    mockGetDepartments.mockResolvedValue([{ id: "d1", name: "Science" }]);

    render(
      await DepartmentsGrid({
        section: makeSection({ intro: "Explore our academic departments." }),
        tenant: makeTenant(),
      }),
    );

    expect(screen.getByText("Explore our academic departments.")).toBeInTheDocument();
  });

  it("renders nothing when there are no departments", async () => {
    mockGetDepartments.mockResolvedValue([]);
    const result = await DepartmentsGrid({ section: makeSection({}), tenant: makeTenant() });
    expect(result).toBeNull();
  });
});
