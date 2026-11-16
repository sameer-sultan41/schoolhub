import { render, screen } from "@testing-library/react";
import { TEST_HOST, sectionProps } from "@/test-utils";
import { getDepartments } from "@/lib/content";
import { DepartmentsGrid } from "../departments-grid";

jest.mock("@/lib/content", () => ({ getDepartments: jest.fn() }));

const mockGetDepartments = getDepartments as jest.MockedFunction<typeof getDepartments>;

describe("DepartmentsGrid", () => {
  beforeEach(() => mockGetDepartments.mockReset());

  it("renders each department", async () => {
    mockGetDepartments.mockResolvedValue([
      { id: "d1", name: "Science", description: "Physics, chemistry, biology" },
    ]);

    render(await DepartmentsGrid(sectionProps({})));

    expect(screen.getByText("Science")).toBeInTheDocument();
    expect(screen.getByText("Physics, chemistry, biology")).toBeInTheDocument();
    expect(mockGetDepartments).toHaveBeenCalledWith("t1", TEST_HOST);
  });

  it("renders an optional intro", async () => {
    mockGetDepartments.mockResolvedValue([{ id: "d1", name: "Science", description: "" }]);

    render(await DepartmentsGrid(sectionProps({ intro: "Explore our academic departments." })));

    expect(screen.getByText("Explore our academic departments.")).toBeInTheDocument();
  });

  it("renders a department with no description", async () => {
    mockGetDepartments.mockResolvedValue([{ id: "d2", name: "Arts", description: "" }]);

    render(await DepartmentsGrid(sectionProps({})));

    expect(screen.getByText("Arts")).toBeInTheDocument();
  });

  it("renders nothing when there are no departments", async () => {
    mockGetDepartments.mockResolvedValue([]);
    const result = await DepartmentsGrid(sectionProps({}));
    expect(result).toBeNull();
  });

  it("renders nothing when props fail validation", async () => {
    const result = await DepartmentsGrid(sectionProps({ heading: 123 }));
    expect(result).toBeNull();
    expect(mockGetDepartments).not.toHaveBeenCalled();
  });
});
