import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { getClasses } from "@/lib/content";
import { ClassesList } from "./classes-list";

jest.mock("@/lib/content", () => ({ getClasses: jest.fn() }));

const mockGetClasses = getClasses as jest.MockedFunction<typeof getClasses>;

describe("ClassesList", () => {
  beforeEach(() => mockGetClasses.mockReset());

  it("renders each class with its description", async () => {
    mockGetClasses.mockResolvedValue([
      { id: "c1", name: "Grade 5", level: "Primary", description: "Ages 10-11" },
    ]);

    render(await ClassesList({ section: makeSection({}), tenant: makeTenant() }));

    expect(screen.getByText("Grade 5")).toBeInTheDocument();
    expect(screen.getByText("Ages 10-11")).toBeInTheDocument();
  });

  it("falls back to level when there is no description", async () => {
    mockGetClasses.mockResolvedValue([{ id: "c1", name: "Grade 5", level: "Primary" }]);

    render(await ClassesList({ section: makeSection({}), tenant: makeTenant() }));

    expect(screen.getByText("Primary")).toBeInTheDocument();
  });

  it("renders an empty description when neither description nor level is set", async () => {
    mockGetClasses.mockResolvedValue([{ id: "c1", name: "Grade 5" }]);

    render(await ClassesList({ section: makeSection({}), tenant: makeTenant() }));

    expect(screen.getByText("Grade 5")).toBeInTheDocument();
  });

  it("renders nothing when there are no classes", async () => {
    mockGetClasses.mockResolvedValue([]);
    const result = await ClassesList({ section: makeSection({}), tenant: makeTenant() });
    expect(result).toBeNull();
  });

  it("renders nothing when props fail validation", async () => {
    const result = await ClassesList({
      section: makeSection({ heading: 123 }),
      tenant: makeTenant(),
    });
    expect(result).toBeNull();
    expect(mockGetClasses).not.toHaveBeenCalled();
  });
});
