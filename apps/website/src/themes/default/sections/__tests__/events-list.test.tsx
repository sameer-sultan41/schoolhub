import { render, screen } from "@testing-library/react";
import { getEvents } from "@/lib/content";
import { TEST_HOST, sectionProps } from "@/test-utils";
import { EventsList } from "../events-list";

jest.mock("@/lib/content", () => ({ getEvents: jest.fn() }));

const mockGetEvents = getEvents as jest.MockedFunction<typeof getEvents>;

function makeEvent(overrides: Partial<Awaited<ReturnType<typeof getEvents>>[number]> = {}) {
  return {
    id: "e1",
    slug: "sports-day",
    title: "Sports Day",
    starts_at: "2027-03-15T09:00:00Z",
    ends_at: null,
    is_all_day: false,
    location: "Main Ground",
    cover_image_url: null,
    ...overrides,
  };
}

describe("EventsList", () => {
  beforeEach(() => mockGetEvents.mockReset());

  it("renders each event's title, linked to its slug, and location", async () => {
    mockGetEvents.mockResolvedValue([makeEvent()]);

    render(await EventsList(sectionProps({})));

    expect(screen.getByRole("link", { name: "Sports Day" })).toHaveAttribute(
      "href",
      "/events/sports-day",
    );
    expect(screen.getByText("Main Ground")).toBeInTheDocument();
  });

  it("passes the host and the configured limit through to getEvents", async () => {
    mockGetEvents.mockResolvedValue([]);
    await EventsList(sectionProps({ limit: 3 }));
    expect(mockGetEvents).toHaveBeenCalledWith("t1", TEST_HOST, 3);
  });

  it("renders an event with no location", async () => {
    mockGetEvents.mockResolvedValue([makeEvent({ id: "e2", title: "PTM", location: "" })]);

    render(await EventsList(sectionProps({})));

    expect(screen.getByText("PTM")).toBeInTheDocument();
    expect(screen.queryByText("Main Ground")).not.toBeInTheDocument();
  });

  it("renders nothing when there are no events", async () => {
    mockGetEvents.mockResolvedValue([]);
    const result = await EventsList(sectionProps({}));
    expect(result).toBeNull();
  });

  it("renders nothing when props fail validation", async () => {
    const result = await EventsList(sectionProps({ limit: 0 }));
    expect(result).toBeNull();
    expect(mockGetEvents).not.toHaveBeenCalled();
  });
});
