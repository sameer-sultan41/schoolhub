import { render, screen } from "@testing-library/react";
import { getClasses } from "@/lib/content";
import { TEST_HOST, sectionProps } from "@/test-utils";
import { ClassesList } from "../classes-list";

jest.mock("@/lib/content", () => ({ getClasses: jest.fn() }));

const mockGetClasses = getClasses as jest.MockedFunction<typeof getClasses>;

describe("ClassesList", () => {
  beforeEach(() => mockGetClasses.mockReset());

  it("renders each opted-in class in the order the API sends", async () => {
    mockGetClasses.mockResolvedValue([
      { id: "c1", name: "Grade 5", level: 5 },
      { id: "c2", name: "Grade 6", level: 6 },
    ]);

    render(await ClassesList(sectionProps({})));

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Grade 5",
      "Grade 6",
    ]);
    expect(mockGetClasses).toHaveBeenCalledWith("t1", TEST_HOST);
  });

  it("renders nothing when there are no classes", async () => {
    mockGetClasses.mockResolvedValue([]);
    const result = await ClassesList(sectionProps({}));
    expect(result).toBeNull();
  });

  it("renders nothing when props fail validation", async () => {
    const result = await ClassesList(sectionProps({ heading: 123 }));
    expect(result).toBeNull();
    expect(mockGetClasses).not.toHaveBeenCalled();
  });
});
