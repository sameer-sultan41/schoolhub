import { render, screen } from "@testing-library/react";
import { getNotices } from "@/lib/content";
import { TEST_HOST, sectionProps } from "@/test-utils";
import { NoticeBoard } from "../notice-board";

jest.mock("@/lib/content", () => ({ getNotices: jest.fn() }));

const mockGetNotices = getNotices as jest.MockedFunction<typeof getNotices>;

function makeNotice(overrides: Partial<Awaited<ReturnType<typeof getNotices>>[number]> = {}) {
  return {
    id: "n1",
    kind: "notice",
    title: "Term dates for 2027",
    body: "",
    published_at: "2027-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("NoticeBoard", () => {
  beforeEach(() => mockGetNotices.mockReset());

  it("renders a notice with its plain-text body", async () => {
    mockGetNotices.mockResolvedValue([makeNotice({ body: "Term starts on 1 April." })]);

    render(await NoticeBoard(sectionProps({ limit: 4 })));

    expect(screen.getByText("Term dates for 2027")).toBeInTheDocument();
    expect(screen.getByText("Term starts on 1 April.")).toBeInTheDocument();
    expect(mockGetNotices).toHaveBeenCalledWith("t1", TEST_HOST, 4);
  });

  it("renders a notice with no body", async () => {
    mockGetNotices.mockResolvedValue([makeNotice({ id: "n2", title: "Office closed Friday" })]);

    const { container } = render(await NoticeBoard(sectionProps({})));

    expect(screen.getByText("Office closed Friday")).toBeInTheDocument();
    expect(container.querySelector("li p")).toBeNull();
  });

  it("renders nothing when there are no notices", async () => {
    mockGetNotices.mockResolvedValue([]);
    const result = await NoticeBoard(sectionProps({}));
    expect(result).toBeNull();
  });

  it("renders nothing when props fail validation", async () => {
    const result = await NoticeBoard(sectionProps({ limit: 0 }));
    expect(result).toBeNull();
    expect(mockGetNotices).not.toHaveBeenCalled();
  });
});
