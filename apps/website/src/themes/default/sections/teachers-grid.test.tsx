import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { getTeachers } from "@/lib/content";
import { TeachersGrid } from "./teachers-grid";

jest.mock("@/lib/content", () => ({ getTeachers: jest.fn() }));

const mockGetTeachers = getTeachers as jest.MockedFunction<typeof getTeachers>;

describe("TeachersGrid", () => {
  beforeEach(() => mockGetTeachers.mockReset());

  it("renders each teacher's name and designation", async () => {
    mockGetTeachers.mockResolvedValue([
      { id: "t1", full_name: "Bilal Ahmed", designation: "Head of Mathematics" },
    ]);

    render(await TeachersGrid({ section: makeSection({}), tenant: makeTenant() }));

    expect(screen.getByText("Bilal Ahmed")).toBeInTheDocument();
    expect(screen.getByText("Head of Mathematics")).toBeInTheDocument();
  });

  it("renders a placeholder avatar when there is no photo", async () => {
    mockGetTeachers.mockResolvedValue([{ id: "t1", full_name: "Bilal Ahmed" }]);

    const { container } = render(
      await TeachersGrid({ section: makeSection({}), tenant: makeTenant() }),
    );

    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders nothing when there are no teachers", async () => {
    mockGetTeachers.mockResolvedValue([]);
    const result = await TeachersGrid({ section: makeSection({}), tenant: makeTenant() });
    expect(result).toBeNull();
  });
});
