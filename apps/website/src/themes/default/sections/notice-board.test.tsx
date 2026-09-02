import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { getNotices } from "@/lib/content";
import { NoticeBoard } from "./notice-board";

jest.mock("@/lib/content", () => ({ getNotices: jest.fn() }));

const mockGetNotices = getNotices as jest.MockedFunction<typeof getNotices>;

describe("NoticeBoard", () => {
  beforeEach(() => mockGetNotices.mockReset());

  it("renders a notice with its body and attachment link", async () => {
    mockGetNotices.mockResolvedValue([
      {
        id: "n1",
        title: "Term dates for 2027",
        published_at: "2027-01-02T00:00:00Z",
        body: "See the attached calendar.",
        attachment_url: "https://cdn.example.com/calendar.pdf",
      },
    ]);

    render(await NoticeBoard({ section: makeSection({}), tenant: makeTenant() }));

    expect(screen.getByText("Term dates for 2027")).toBeInTheDocument();
    expect(screen.getByText("See the attached calendar.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download attachment" })).toHaveAttribute(
      "href",
      "https://cdn.example.com/calendar.pdf",
    );
  });

  it("renders nothing when there are no notices", async () => {
    mockGetNotices.mockResolvedValue([]);
    const result = await NoticeBoard({ section: makeSection({}), tenant: makeTenant() });
    expect(result).toBeNull();
  });
});
