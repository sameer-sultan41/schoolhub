import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { sessionRecord } from "@/services/modules/school-organization/__tests__/structure-fixtures";
import {
  CLOSED_SESSION_ID,
  PLANNED_SESSION_ID,
  SESSION_ID,
  termRecord,
} from "@/test-fixtures/academics";
import { cursorPage } from "@/test-fixtures/list-screen";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { SessionsSection } from "../sessions-section";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    schoolOrganization: {
      fetchSessionPage: jest.fn(),
      createSession: jest.fn(),
      updateSession: jest.fn(),
      activateSession: jest.fn(),
      closeSession: jest.fn(),
      cloneSession: jest.fn(),
      fetchTerms: jest.fn(),
      createTerm: jest.fn(),
      updateTerm: jest.fn(),
    },
  },
}));

const so = Services.schoolOrganization as jest.Mocked<typeof Services.schoolOrganization>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const SESSION_WRITE_KEYS: PermissionKey[] = [
  "school.academic-session.view",
  "school.academic-session.create",
  "school.academic-session.update",
  "school.academic-session.activate",
  "school.academic-session.close",
];

const current = sessionRecord();
const planned = sessionRecord({
  id: PLANNED_SESSION_ID,
  name: "2027-28",
  start_date: "2027-04-01",
  end_date: "2028-03-31",
  status: "planned",
  is_current: false,
});
const closed = sessionRecord({
  id: CLOSED_SESSION_ID,
  name: "2025-26",
  start_date: "2025-04-01",
  end_date: "2026-03-31",
  status: "closed",
  is_current: false,
});

/** What `session_completeness_errors` lists for a school with nothing set up, in its order,
 * as the envelope flattens `{structure: [...]}`: one detail per sentence. */
const STRUCTURE_GAPS = [
  "At least one active campus is required.",
  "At least one active class with an active section is required.",
  "At least one term is required.",
];

function structureRefusal() {
  return new ApiError({
    code: "domain_rule_violation",
    // More than one detail: the envelope's message is the status's code, not a sentence.
    message: "unprocessable",
    status: 422,
    url: `/academic-sessions/${PLANNED_SESSION_ID}:activate`,
    details: STRUCTURE_GAPS.map((issue) => ({ field: "structure", issue })),
  });
}

function renderSection() {
  renderWithProviders(<SessionsSection />);
  return userEvent.setup();
}

function fillDates(scope: HTMLElement, start: string, end: string) {
  fireEvent.change(within(scope).getByLabelText("Start date"), { target: { value: start } });
  fireEvent.change(within(scope).getByLabelText("End date"), { target: { value: end } });
}

describe("sessions section", () => {
  beforeEach(() => {
    setUrl("/school/sessions");
    mockFetchCurrentUser.mockReset().mockResolvedValue(buildUser(SESSION_WRITE_KEYS));
    so.fetchSessionPage.mockReset().mockResolvedValue(cursorPage([planned, current, closed]));
    so.fetchTerms.mockReset().mockResolvedValue([termRecord()]);
    for (const write of [
      so.createSession,
      so.updateSession,
      so.activateSession,
      so.closeSession,
      so.cloneSession,
      so.createTerm,
      so.updateTerm,
    ]) {
      write.mockReset();
    }
  });

  it("lists the sessions newest first, each with its dates and status", async () => {
    renderSection();

    const row = await screen.findByRole("row", { name: /2026-27/ });
    expect(within(row).getByText("April 1st, 2026 to March 31st, 2027")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(within(row).getByText("Current")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /2027-28/ })).getByText("Planned"),
    ).toBeInTheDocument();
    expect(so.fetchSessionPage).toHaveBeenCalledWith({
      cursor: undefined,
      pageSize: 25,
      search: undefined,
      ordering: "-start_date",
      status: undefined,
    });
  });

  it("offers Activate on a planned session and Close on the active one only", async () => {
    renderSection();

    await screen.findByRole("row", { name: /2027-28/ });
    expect(screen.getByRole("button", { name: "Activate 2027-28" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close 2026-27" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate 2026-27" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Activate|Close) 2025-26$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Clone 2025-26" })).toBeInTheDocument();
  });

  it("shows the server's structure errors as a checklist when activation is refused", async () => {
    so.activateSession.mockRejectedValue(structureRefusal());
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Activate 2027-28" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Activate session" }));

    const checklist = await within(dialog).findByRole("list");
    expect(
      within(checklist)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(STRUCTURE_GAPS);
    expect(within(dialog).getByText("Finish these before activating:")).toBeInTheDocument();
    // The gaps show once, as the list: not also folded into one sentence, nor as the code.
    expect(within(dialog).queryByText("unprocessable")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(STRUCTURE_GAPS.join(" "))).not.toBeInTheDocument();
    expect(so.activateSession).toHaveBeenCalledWith(PLANNED_SESSION_ID);
  });

  it("activates a planned session and closes the dialog", async () => {
    so.activateSession.mockResolvedValue({ ...planned, status: "active", is_current: true });
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Activate 2027-28" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Activate session" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(so.activateSession).toHaveBeenCalledTimes(1);
  });

  it("closes the active session, showing a refusal as one sentence", async () => {
    const issue = "Only an active session can be closed; this one is closed.";
    so.closeSession
      .mockRejectedValueOnce(
        new ApiError({
          code: "conflict",
          message: issue,
          status: 409,
          url: `/academic-sessions/${SESSION_ID}:close`,
          details: [{ field: "non_field", issue }],
        }),
      )
      .mockResolvedValueOnce({ ...current, status: "closed", is_current: false });
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Close 2026-27" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Close session" }));
    expect(await within(dialog).findByText(issue)).toBeInTheDocument();
    expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close session" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(so.closeSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it("posts the new session's name and dates from the clone dialog", async () => {
    so.cloneSession.mockResolvedValue(planned);
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Clone 2026-27" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "2027-28");
    fillDates(dialog, "2027-04-01", "2028-03-31");
    await user.click(within(dialog).getByRole("button", { name: "Clone" }));

    await waitFor(() => {
      expect(so.cloneSession).toHaveBeenCalledWith(SESSION_ID, {
        name: "2027-28",
        start_date: "2027-04-01",
        end_date: "2028-03-31",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("refuses a clone whose end is not after its start, before sending", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Clone 2026-27" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "2027-28");
    fillDates(dialog, "2028-03-31", "2028-03-31");
    await user.click(within(dialog).getByRole("button", { name: "Clone" }));

    expect(
      await within(dialog).findByText("The end date must be after the start date."),
    ).toBeInTheDocument();
    expect(so.cloneSession).not.toHaveBeenCalled();
  });

  it("adds a session, and shows the server's overlap refusal as the form's message", async () => {
    const issue = "Dates overlap academic session '2026-27' (2026-04-01 – 2027-03-31).";
    so.createSession.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: issue,
        status: 422,
        url: "/academic-sessions",
        details: [{ field: "non_field", issue }],
      }),
    );
    const user = renderSection();

    // The row's Edit means the viewer's keys are known, so Add is enabled.
    await screen.findByRole("button", { name: "Edit 2026-27" });
    await user.click(screen.getByRole("button", { name: "Add session" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "2026-27 bis");
    fillDates(dialog, "2026-06-01", "2027-05-31");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(issue)).toBeInTheDocument();
    expect(so.createSession).toHaveBeenCalledWith({
      name: "2026-27 bis",
      start_date: "2026-06-01",
      end_date: "2027-05-31",
    });
  });

  it("edits a session's name and dates", async () => {
    so.updateSession.mockResolvedValue({ ...current, name: "2026/27" });
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit 2026-27" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "2026/27");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.updateSession).toHaveBeenCalledWith(SESSION_ID, {
        name: "2026/27",
        start_date: "2026-04-01",
        end_date: "2027-03-31",
      });
    });
  });

  it("names the overlapping term in the form's message", async () => {
    const issue = "Term dates overlap term 'Term 1'.";
    so.createTerm.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: issue,
        status: 422,
        url: "/terms",
        details: [{ field: "non_field", issue }],
      }),
    );
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show terms for 2026-27" }));
    expect(await screen.findByText("Term 1")).toBeInTheDocument();
    expect(so.fetchTerms).toHaveBeenCalledWith(SESSION_ID);
    await user.click(screen.getByRole("button", { name: "Add term" }));
    const dialog = await screen.findByRole("dialog");
    // A new term goes after the session's last one.
    expect(within(dialog).getByLabelText("Order")).toHaveValue("2");
    await user.type(within(dialog).getByLabelText("Name"), "Term 2");
    fillDates(dialog, "2026-09-01", "2027-03-31");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(issue)).toBeInTheDocument();
    expect(so.createTerm).toHaveBeenCalledWith({
      academic_session_id: SESSION_ID,
      name: "Term 2",
      sequence: 2,
      start_date: "2026-09-01",
      end_date: "2027-03-31",
    });
  });

  it("edits a term, and refuses an order that isn't a whole number from 1", async () => {
    so.updateTerm.mockResolvedValue(termRecord({ name: "Autumn" }));
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show terms for 2026-27" }));
    await user.click(await screen.findByRole("button", { name: "Edit Term 1" }));
    const dialog = await screen.findByRole("dialog");
    const order = within(dialog).getByLabelText("Order");
    await user.clear(order);
    await user.type(order, "0");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Enter a whole number from 1.")).toBeInTheDocument();
    expect(so.updateTerm).not.toHaveBeenCalled();

    await user.clear(order);
    await user.type(order, "1");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Autumn");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.updateTerm).toHaveBeenCalledWith(termRecord().id, {
        name: "Autumn",
        sequence: 1,
        start_date: "2026-04-01",
        end_date: "2026-09-30",
      });
    });
  });

  it("keeps a closed session's terms read only", async () => {
    so.fetchTerms.mockResolvedValue([termRecord({ academic_session_id: CLOSED_SESSION_ID })]);
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show terms for 2025-26" }));

    expect(
      await screen.findByText("This session is closed or archived, so its terms can't change."),
    ).toBeInTheDocument();
    expect(screen.getByText("Term 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add term" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Term 1" })).not.toBeInTheDocument();
  });

  it("offers Add term only once the terms have loaded", async () => {
    so.fetchTerms.mockReset().mockReturnValue(new Promise(() => undefined));
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show terms for 2026-27" }));

    await screen.findByRole("button", { name: "Edit 2026-27" });
    expect(screen.queryByRole("button", { name: "Add term" })).not.toBeInTheDocument();
  });

  it("offers no Edit on a closed session", async () => {
    renderSection();

    await screen.findByRole("button", { name: "Edit 2026-27" });
    expect(screen.getByRole("row", { name: /2025-26/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit 2025-26" })).not.toBeInTheDocument();
  });

  it("shows only the terms to a viewer without the session write keys", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["school.academic-session.view"]));
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show terms for 2026-27" }));
    expect(await screen.findByText("Term 1")).toBeInTheDocument();

    // Add is held disabled until the viewer's keys load, then dropped for want of `create`.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Add session" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Add term" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Edit|Clone|Activate|Close) / })).toBeNull();
  });

  it("filters by status through the API", async () => {
    const user = renderSection();

    await screen.findByRole("row", { name: /2026-27/ });
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Planned" }));

    await waitFor(() => {
      expect(so.fetchSessionPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "planned", cursor: undefined }),
      );
    });
  });
});
