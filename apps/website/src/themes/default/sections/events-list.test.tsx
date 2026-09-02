import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { getEvents } from "@/lib/content";
import { EventsList } from "./events-list";

jest.mock("@/lib/content", () => ({ getEvents: jest.fn() }));

const mockGetEvents = getEvents as jest.MockedFunction<typeof getEvents>;

describe("EventsList", () => {
  beforeEach(() => mockGetEvents.mockReset());

  it("renders each event's title, location and summary", async () => {
    mockGetEvents.mockResolvedValue([
      {
        id: "e1",
        title: "Sports Day",
        starts_at: "2027-03-15T09:00:00Z",
        location: "Main Ground",
        summary: "Annual inter-house sports competition.",
      },
    ]);

    render(await EventsList({ section: makeSection({}), tenant: makeTenant() }));

    expect(screen.getByText("Sports Day")).toBeInTheDocument();
    expect(screen.getByText("Main Ground")).toBeInTheDocument();
    expect(screen.getByText("Annual inter-house sports competition.")).toBeInTheDocument();
  });

  it("passes the configured limit through to getEvents", async () => {
    mockGetEvents.mockResolvedValue([]);
    await EventsList({ section: makeSection({ limit: 3 }), tenant: makeTenant() });
    expect(mockGetEvents).toHaveBeenCalledWith("t1", 3);
  });

  it("renders nothing when there are no events", async () => {
    mockGetEvents.mockResolvedValue([]);
    const result = await EventsList({ section: makeSection({}), tenant: makeTenant() });
    expect(result).toBeNull();
  });
});
