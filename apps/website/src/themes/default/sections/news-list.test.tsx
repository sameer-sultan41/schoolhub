import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { getNews } from "@/lib/content";
import { NewsList } from "./news-list";

jest.mock("@/lib/content", () => ({ getNews: jest.fn() }));

const mockGetNews = getNews as jest.MockedFunction<typeof getNews>;

describe("NewsList", () => {
  beforeEach(() => mockGetNews.mockReset());

  it("renders each post's title and excerpt, linked to its slug", async () => {
    mockGetNews.mockResolvedValue([
      {
        id: "n1",
        title: "New science lab opens",
        slug: "new-science-lab-opens",
        published_at: "2027-01-10T00:00:00Z",
        excerpt: "A state-of-the-art facility for our students.",
      },
    ]);

    render(await NewsList({ section: makeSection({}), tenant: makeTenant() }));

    const link = screen.getByRole("link", { name: "New science lab opens" });
    expect(link).toHaveAttribute("href", "/news/new-science-lab-opens");
    expect(screen.getByText("A state-of-the-art facility for our students.")).toBeInTheDocument();
  });

  it("renders nothing when there are no posts", async () => {
    mockGetNews.mockResolvedValue([]);
    const result = await NewsList({ section: makeSection({}), tenant: makeTenant() });
    expect(result).toBeNull();
  });
});
