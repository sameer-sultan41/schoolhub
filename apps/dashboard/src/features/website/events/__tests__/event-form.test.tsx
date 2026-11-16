import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";

import {
  EVENT_ID,
  pageOf,
  schoolEvent,
  violation,
} from "@/features/website/shared/__tests__/content-fixtures";
import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { EventDirectory } from "../event-directory";
import { eventDatesIssue } from "../event-form-schema";
import { EventToolbar } from "../event-toolbar";

jest.mock("next/navigation", () =>
  jest
    .requireActual<{ createNavigationMock: () => unknown }>("@/test-utils")
    .createNavigationMock(),
);

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{
      contentServicesMock: () => unknown;
    }>("../../shared/__tests__/content-services-mock")
    .contentServicesMock(),
);

const events = Services.schoolEvents;
const createEvent = mocked(events.createSchoolEvent);
const updateEvent = mocked(events.updateSchoolEvent);

/** Every event key the seeded `school_admin` holds (module doc §4); events have no delete. */
const EDITOR_KEYS: PermissionKey[] = [
  "website.school-event.create",
  "website.school-event.update",
  "website.school-event.publish",
];

const END_BEFORE_START = "The event can't end before it starts.";

function setInput(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
}

async function renderScreen() {
  renderWithProviders(
    <>
      <UserLoaded />
      <EventToolbar />
      <EventDirectory />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

async function openNewEvent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New event" }));
  const dialog = await screen.findByRole("dialog", { name: "New event" });
  await user.type(within(dialog).getByLabelText("Title"), "Prize day");
  return dialog;
}

describe("event form", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUrl("/website/events");
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["website.page.view", ...EDITOR_KEYS]),
    );
    mocked(events.fetchSchoolEventPage).mockResolvedValue(pageOf([schoolEvent()]));
    mocked(events.fetchSchoolEvent).mockResolvedValue(schoolEvent());
  });

  it("refuses an end before the start before sending anything", async () => {
    const user = await renderScreen();
    const dialog = await openNewEvent(user);

    setInput(dialog, "Starts", "2026-12-10T10:00");
    setInput(dialog, "Ends", "2026-12-10T09:00");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(END_BEFORE_START)).toBeVisible();
    expect(within(dialog).getByLabelText("Ends")).toHaveAttribute("aria-invalid", "true");
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("asks for a start", async () => {
    const user = await renderScreen();
    const dialog = await openNewEvent(user);

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Enter when the event starts.")).toBeVisible();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("maps the server's end_before_start under the end, in the viewer's words", async () => {
    updateEvent.mockRejectedValue(
      violation("ends_at", "end_before_start", "the event cannot end before it starts."),
    );
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Edit Annual prize day" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit event" });
    expect(await within(dialog).findByDisplayValue("Main hall")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(END_BEFORE_START)).toBeVisible();
    expect(within(dialog).getByLabelText("Ends")).toHaveAttribute("aria-invalid", "true");
    expect(updateEvent).toHaveBeenCalledWith(
      EVENT_ID,
      expect.objectContaining({
        starts_at: "2026-12-10T05:00:00.000Z",
        ends_at: "2026-12-10T08:00:00.000Z",
      }),
    );
  });

  it("sends an all-day event as its day's local midnight, with no end", async () => {
    createEvent.mockResolvedValue(schoolEvent());
    const user = await renderScreen();
    const dialog = await openNewEvent(user);

    await user.click(within(dialog).getByRole("switch", { name: "All day" }));
    setInput(dialog, "Starts", "2026-12-10");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createEvent).toHaveBeenCalledWith({
        title: "Prize day",
        slug: "prize-day",
        is_all_day: true,
        starts_at: new Date(2026, 11, 10).toISOString(),
        ends_at: null,
        location: "",
        description: { blocks: [] },
      });
    });
  });

  it("keeps a published event read-only, with the reason, without the publish key", async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
      buildUser([
        "website.page.view",
        "website.school-event.create",
        "website.school-event.update",
      ]),
    );
    const live = schoolEvent({ status: "published" });
    mocked(events.fetchSchoolEventPage).mockResolvedValue(pageOf([live]));
    mocked(events.fetchSchoolEvent).mockResolvedValue(live);
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Annual prize day" }));
    const sheet = await screen.findByRole("dialog", { name: "Annual prize day" });

    expect(
      await within(sheet).findByText(
        "This is live: only a publisher can change it. Ask a publisher, or have it unpublished first.",
      ),
    ).toBeVisible();
    expect(within(sheet).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Annual prize day" })).not.toBeInTheDocument();
  });

  it("offers the lifecycle but no Delete on an event", async () => {
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Annual prize day" }));
    const sheet = await screen.findByRole("dialog", { name: "Annual prize day" });

    expect(await within(sheet).findByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});

describe("eventDatesIssue", () => {
  const messages = { startRequired: "start", endBeforeStart: "end" };

  it.each([
    [{ is_all_day: false, starts_at: "2026-12-10T10:00", ends_at: "" }, null],
    [{ is_all_day: false, starts_at: "2026-12-10T10:00", ends_at: "2026-12-10T10:00" }, null],
    [{ is_all_day: true, starts_at: "2026-12-10", ends_at: "2026-12-09" }, "ends_at"],
    [{ is_all_day: true, starts_at: "", ends_at: "" }, "starts_at"],
  ])("%o -> %s", (values, field) => {
    expect(eventDatesIssue(values, messages)?.path[0] ?? null).toBe(field);
  });
});
