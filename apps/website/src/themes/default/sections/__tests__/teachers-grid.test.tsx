import { render, screen } from "@testing-library/react";
import { sectionProps } from "@/test-utils";
import { getTeachers } from "@/lib/content";
import { TeachersGrid } from "../teachers-grid";

jest.mock("@/lib/content", () => ({ getTeachers: jest.fn() }));

const mockGetTeachers = getTeachers as jest.MockedFunction<typeof getTeachers>;

function makeTeacher(overrides: Partial<Awaited<ReturnType<typeof getTeachers>>[number]> = {}) {
  return {
    id: "t1",
    full_name: "Bilal Ahmed",
    designation: "",
    photo_url: null,
    bio: "",
    ...overrides,
  };
}

describe("TeachersGrid", () => {
  beforeEach(() => mockGetTeachers.mockReset());

  it("renders each teacher's name and designation", async () => {
    mockGetTeachers.mockResolvedValue([makeTeacher({ designation: "Head of Mathematics" })]);

    render(await TeachersGrid(sectionProps({})));

    expect(screen.getByText("Bilal Ahmed")).toBeInTheDocument();
    expect(screen.getByText("Head of Mathematics")).toBeInTheDocument();
  });

  it("renders a placeholder avatar when there is no photo", async () => {
    mockGetTeachers.mockResolvedValue([makeTeacher()]);

    const { container } = render(await TeachersGrid(sectionProps({})));

    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a teacher photo when one is given", async () => {
    mockGetTeachers.mockResolvedValue([
      makeTeacher({
        id: "t2",
        full_name: "Sara Malik",
        photo_url: "https://api.test.invalid/api/v1/public/files/t1/f1",
      }),
    ]);

    // The photo has alt="" (decorative), so it has ARIA role "presentation", not "img" —
    // query the DOM directly rather than by role.
    const { container } = render(await TeachersGrid(sectionProps({})));

    expect(container.querySelector("img")).not.toBeNull();
  });

  it("renders nothing when there are no teachers", async () => {
    mockGetTeachers.mockResolvedValue([]);
    const result = await TeachersGrid(sectionProps({}));
    expect(result).toBeNull();
  });

  it("renders nothing when props fail validation", async () => {
    const result = await TeachersGrid(sectionProps({ limit: 0 }));
    expect(result).toBeNull();
    expect(mockGetTeachers).not.toHaveBeenCalled();
  });
});
