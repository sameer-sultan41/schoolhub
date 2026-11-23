import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { getEvent, getSite } from "@/lib/content";
import { resolveTenant } from "@/lib/tenant";
import { makeEventDetail, makeSite, makeTenant } from "@/test-utils";
import EventPage, { generateMetadata } from "../page";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/content", () => ({ getEvent: jest.fn(), getSite: jest.fn() }));
jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  canonicalOrigin: jest.requireActual("@/lib/tenant").canonicalOrigin,
}));
jest.mock("@/themes", () => ({
  getTheme: () => ({ Navigation: () => <nav />, Footer: () => <footer /> }),
}));

const mockGetEvent = getEvent as jest.MockedFunction<typeof getEvent>;
const mockGetSite = getSite as jest.MockedFunction<typeof getSite>;
const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;
const mockNotFound = notFound as jest.MockedFunction<typeof notFound>;

const HOST = "cityschool.schoolhub.pk";
const params = (slug = "annual-day") => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  mockNotFound.mockClear();
  mockGetEvent.mockReset();
  mockGetSite.mockReset().mockResolvedValue(null);
  mockResolveTenant.mockReset().mockResolvedValue({
    status: "active",
    tenant: makeTenant(),
    host: HOST,
  });
});

function jsonLd(container: HTMLElement): Record<string, unknown> {
  const script = container.querySelector('script[type="application/ld+json"]');
  return JSON.parse(script?.textContent ?? "") as Record<string, unknown>;
}

describe("EventPage", () => {
  it("is a 404 when the API returns no event", async () => {
    mockGetEvent.mockResolvedValue(null);
    await expect(EventPage(params("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockGetEvent).toHaveBeenCalledWith("t1", HOST, "missing");
  });

  it("is a 404 for an unknown host and a notice for an unavailable site", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(EventPage(params())).rejects.toThrow("NEXT_NOT_FOUND");

    mockResolveTenant.mockResolvedValue({
      status: "unavailable",
      tenant: makeTenant(),
      host: HOST,
    });
    render(await EventPage(params()));
    expect(screen.getByText("This website is unavailable")).toBeInTheDocument();
  });

  it("renders the event with its location and description, and Event structured data", async () => {
    mockGetEvent.mockResolvedValue(
      makeEventDetail({ ends_at: "2027-04-12T07:00:00Z", cover_image_url: "https://x.test/c" }),
    );
    const { container } = render(await EventPage(params()));

    expect(screen.getByRole("heading", { level: 1, name: "Annual day" })).toBeInTheDocument();
    expect(screen.getByText("Main hall")).toBeInTheDocument();
    expect(screen.getByText("Parents are welcome.")).toBeInTheDocument();
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2027-04-12T04:00:00Z");
    expect(jsonLd(container)).toMatchObject({
      "@type": "Event",
      name: "Annual day",
      startDate: "2027-04-12T04:00:00Z",
      endDate: "2027-04-12T07:00:00Z",
      location: { "@type": "Place", name: "Main hall" },
      image: ["https://x.test/c"],
      url: `https://${HOST}/events/annual-day`,
      organizer: { "@type": "Organization", name: "City School" },
    });
  });

  it("marks an all-day event and leaves out what it does not have", async () => {
    mockGetEvent.mockResolvedValue(makeEventDetail({ is_all_day: true, location: "" }));
    const { container } = render(await EventPage(params()));

    expect(screen.getByText(/All day/)).toBeInTheDocument();
    const data = jsonLd(container);
    expect(data).not.toHaveProperty("endDate");
    expect(data).not.toHaveProperty("location");
    expect(data).not.toHaveProperty("image");
  });
});

describe("generateMetadata", () => {
  it("follows a site-wide noindex", async () => {
    mockGetEvent.mockResolvedValue(makeEventDetail());
    mockGetSite.mockResolvedValue(makeSite({ seo: { ...makeSite().seo, noindex: true } }));

    const metadata = await generateMetadata(params());

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("is indexable on a live site with no site-wide noindex", async () => {
    mockGetEvent.mockResolvedValue(makeEventDetail());
    await expect(generateMetadata(params())).resolves.toMatchObject({
      robots: { index: true, follow: true },
    });
  });

  it("titles the event on its canonical URL", async () => {
    mockGetEvent.mockResolvedValue(makeEventDetail({ cover_image_url: "https://x.test/c" }));
    const metadata = await generateMetadata(params());

    expect(metadata.title).toBe("Annual day");
    expect(metadata.alternates).toEqual({ canonical: `https://${HOST}/events/annual-day` });
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "https://x.test/c" }] });
  });

  it("is unindexed for a missing event or an unavailable site", async () => {
    mockGetEvent.mockResolvedValue(null);
    await expect(generateMetadata(params())).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
    mockResolveTenant.mockResolvedValue({
      status: "unavailable",
      tenant: makeTenant(),
      host: HOST,
    });
    await expect(generateMetadata(params())).resolves.toMatchObject({ title: "Not available" });
  });
});
