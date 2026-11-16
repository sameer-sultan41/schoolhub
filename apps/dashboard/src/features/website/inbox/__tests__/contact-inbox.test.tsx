import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";
import { toast } from "sonner";

import { ApiError, Services, type ContactSubmissionRecord } from "@/services";
import { mocked, rowOf, urlParam } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { pageOf, STAMP } from "@/features/website/shared/__tests__/content-fixtures";
import { ContactInbox } from "../contact-inbox";

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
    .requireActual<{ inboxServicesMock: () => unknown }>("./inbox-services-mock")
    .inboxServicesMock(),
);

const fetchPage = mocked(Services.contactSubmissions.fetchContactSubmissionPage);
const fetchOne = mocked(Services.contactSubmissions.fetchContactSubmission);
const setStatus = mocked(Services.contactSubmissions.setContactSubmissionStatus);

/** `reception`'s keys (`website_cms/permissions.py`: `INBOX_STAFF`). */
const RECEPTION_KEYS: PermissionKey[] = [
  "website.contact-submission.view",
  "website.contact-submission.update",
];

function submission(overrides: Partial<ContactSubmissionRecord> = {}): ContactSubmissionRecord {
  return {
    id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
    name: "Ayesha Khan",
    email: "ayesha@example.com",
    phone: "",
    subject: "Admissions for grade 3",
    message: "Is there a place in grade 3?\nWe are moving in March.",
    source_page_id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
    status: "new",
    // Nobody has triaged a new message yet.
    handled_by_id: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

const spam = submission({
  id: "6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c",
  name: "Prize Desk",
  email: "",
  phone: "+92 300 0000000",
  subject: "",
  // Sent with no page named, and triaged by a member of staff.
  source_page_id: null,
  status: "spam",
  handled_by_id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
});

/** Whoever triaged a message: the server sets `handled_by_id` to the caller on a PATCH. */
const STAFF_ID = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

/** The message as the server holds it: a PATCH changes what the next GET reads. */
let current: ContactSubmissionRecord;

async function renderInbox(keys: PermissionKey[] = RECEPTION_KEYS) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(keys));
  renderWithProviders(
    <>
      <UserLoaded />
      <ContactInbox />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

beforeEach(() => {
  jest.clearAllMocks();
  setUrl("/website/inbox");
  current = submission();
  fetchPage.mockImplementation(() => Promise.resolve(pageOf([current, spam])));
  fetchOne.mockImplementation(() => Promise.resolve(current));
  setStatus.mockImplementation((_id, status) => {
    current = { ...current, status, handled_by_id: STAFF_ID, updated_at: "2026-11-16T09:00:00Z" };
    return Promise.resolve(current);
  });
});

describe("contact inbox", () => {
  it("lists each message with its sender, subject, contact and status", async () => {
    await renderInbox();

    expect(await screen.findByRole("table", { name: "Contact messages" })).toBeInTheDocument();
    const ayesha = rowOf("Ayesha Khan");
    expect(ayesha.getByText("Admissions for grade 3")).toBeInTheDocument();
    expect(ayesha.getByText("ayesha@example.com")).toBeInTheDocument();
    expect(ayesha.getByText("New")).toBeInTheDocument();
    const prize = rowOf("Prize Desk");
    expect(prize.getByText("(No subject)")).toBeInTheDocument();
    expect(prize.getByText("+92 300 0000000")).toBeInTheDocument();
    expect(prize.getByText("Spam")).toBeInTheDocument();
  });

  it("filters by status and an inclusive received-date range through the URL", async () => {
    const user = await renderInbox();
    await screen.findByText("Ayesha Khan");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Spam" }));
    fireEvent.change(screen.getByLabelText("Received from"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Received to"), { target: { value: "2026-11-30" } });

    await waitFor(() => {
      expect(urlParam("to")).toBe("2026-11-30");
    });
    expect(urlParam("status")).toBe("spam");
    expect(urlParam("from")).toBe("2026-11-01");
    expect(fetchPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "spam",
        createdFrom: new Date(2026, 10, 1).toISOString(),
        createdBefore: new Date(2026, 11, 1).toISOString(),
      }),
    );
  });

  it("reads the filters back from a shared link", async () => {
    setUrl("/website/inbox?status=responded&from=2026-10-01");
    await renderInbox();

    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "responded",
          createdFrom: new Date(2026, 9, 1).toISOString(),
          createdBefore: undefined,
        }),
      );
    });
  });

  it("opens a new message without changing it, then marks it read and responded", async () => {
    const user = await renderInbox();

    await user.click(
      await screen.findByRole("button", { name: "Open the message from Ayesha Khan" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Ayesha Khan" });
    expect(await within(sheet).findByText(/We are moving in March/)).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "ayesha@example.com" })).toHaveAttribute(
      "href",
      "mailto:ayesha@example.com",
    );
    expect(within(sheet).getByText("New")).toBeInTheDocument();
    expect(setStatus).not.toHaveBeenCalled();

    await user.click(within(sheet).getByRole("button", { name: "Mark read" }));
    expect(await within(sheet).findByText("Read")).toBeInTheDocument();
    expect(setStatus).toHaveBeenCalledWith(current.id, "read");
    expect(toast.success).toHaveBeenCalledWith("Marked read.");
    expect(within(sheet).queryByRole("button", { name: "Mark read" })).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Mark responded" }));
    expect(await within(sheet).findByText("Responded")).toBeInTheDocument();
    expect(setStatus).toHaveBeenLastCalledWith(current.id, "responded");
  });

  it("shows a refused status change in the sheet", async () => {
    // The viewer's role lost `website.contact-submission.update` after sign-in.
    setStatus.mockRejectedValue(
      new ApiError({
        code: "permission_denied",
        message: "You do not have permission to perform this action.",
        status: 403,
        url: "/api/v1/contact-submissions",
      }),
    );
    const user = await renderInbox();

    await user.click(
      await screen.findByRole("button", { name: "Open the message from Ayesha Khan" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Ayesha Khan" });
    await user.click(await within(sheet).findByRole("button", { name: "Mark as spam" }));

    expect(
      await within(sheet).findByText("You do not have permission to do that."),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("New")).toBeInTheDocument();
  });

  it("keeps the open message when the list fails to refresh behind it", async () => {
    const user = await renderInbox();
    await user.click(
      await screen.findByRole("button", { name: "Open the message from Ayesha Khan" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Ayesha Khan" });
    fetchPage.mockRejectedValue(
      new ApiError({ code: "server_error", message: "Boom.", status: 500, url: "/api/v1/x" }),
    );

    // Triage invalidates the website queries, so the list reads again and fails.
    await user.click(await within(sheet).findByRole("button", { name: "Mark read" }));

    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Ayesha Khan" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog", { name: "Ayesha Khan" })).getByText("Read"),
    ).toBeInTheDocument();
  });

  it("offers no triage to a viewer with only the read key", async () => {
    const user = await renderInbox(["website.contact-submission.view"]);

    await user.click(
      await screen.findByRole("button", { name: "Open the message from Ayesha Khan" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Ayesha Khan" });
    await within(sheet).findByText(/We are moving in March/);

    expect(within(sheet).queryByRole("button", { name: "Mark read" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Mark as spam" })).not.toBeInTheDocument();
  });

  it("says when the inbox is empty", async () => {
    fetchPage.mockResolvedValue(pageOf([]));
    await renderInbox();
    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
  });
});
