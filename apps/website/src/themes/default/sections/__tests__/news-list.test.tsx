import { render, screen } from "@testing-library/react";
import { getNews } from "@/lib/content";
import { TEST_HOST, sectionProps } from "@/test-utils";
import { NewsList } from "../news-list";

jest.mock("@/lib/content", () => ({ getNews: jest.fn() }));

const mockGetNews = getNews as jest.MockedFunction<typeof getNews>;

function makePost(overrides: Partial<Awaited<ReturnType<typeof getNews>>[number]> = {}) {
  return {
    id: "n1",
    slug: "new-science-lab-opens",
    title: "New science lab opens",
    excerpt: "",
    cover_image_url: null,
    published_at: "2027-01-10T00:00:00Z",
    ...overrides,
  };
}

describe("NewsList", () => {
  beforeEach(() => mockGetNews.mockReset());

  it("renders each post's title and excerpt, linked to its slug", async () => {
    mockGetNews.mockResolvedValue([
      makePost({ excerpt: "A state-of-the-art facility for our students." }),
    ]);

    render(await NewsList(sectionProps({ limit: 3 })));

    const link = screen.getByRole("link", { name: "New science lab opens" });
    expect(link).toHaveAttribute("href", "/news/new-science-lab-opens");
    expect(screen.getByText("A state-of-the-art facility for our students.")).toBeInTheDocument();
    expect(mockGetNews).toHaveBeenCalledWith("t1", TEST_HOST, 3);
  });

  it("renders a post's cover image", async () => {
    mockGetNews.mockResolvedValue([
      makePost({ cover_image_url: "https://api.test.invalid/api/v1/public/files/t1/f1" }),
    ]);

    const { container } = render(await NewsList(sectionProps({})));

    expect(container.querySelector("img")).not.toBeNull();
  });

  it("renders a post with no cover image, excerpt or publish date", async () => {
    mockGetNews.mockResolvedValue([
      makePost({ id: "n2", title: "Sports day rescheduled", published_at: null }),
    ]);

    const { container } = render(await NewsList(sectionProps({})));

    expect(screen.getByRole("link", { name: "Sports day rescheduled" })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("time")).toBeNull();
  });

  it("renders nothing when there are no posts", async () => {
    mockGetNews.mockResolvedValue([]);
    const result = await NewsList(sectionProps({}));
    expect(result).toBeNull();
  });

  it("renders nothing when props fail validation", async () => {
    const result = await NewsList(sectionProps({ limit: 0 }));
    expect(result).toBeNull();
    expect(mockGetNews).not.toHaveBeenCalled();
  });
});
