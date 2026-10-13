import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AcademicSessionSummary } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { SessionPicker } from "../session-picker";

const SESSIONS: AcademicSessionSummary[] = [
  { id: "sess-current", name: "2026-27", status: "active", is_current: true },
  { id: "sess-planned", name: "2027-28", status: "planned", is_current: false },
  { id: "sess-closed", name: "2025-26", status: "closed", is_current: false },
  { id: "sess-archived", name: "2024-25", status: "archived", is_current: false },
];

async function openPicker() {
  await userEvent.click(screen.getByRole("combobox", { name: "Academic session" }));
}

describe("SessionPicker", () => {
  it("lists every session by name, marking the current one and the locked ones", async () => {
    renderWithProviders(
      <SessionPicker sessions={SESSIONS} value="sess-planned" onChange={jest.fn()} />,
    );

    await openPicker();

    expect(await screen.findByRole("option", { name: /2026-27/ })).toHaveTextContent("Current");
    const planned = screen.getByRole("option", { name: /2027-28/ });
    expect(planned).not.toHaveTextContent(/Current|Closed/);
    expect(screen.getByRole("option", { name: /2025-26/ })).toHaveTextContent("Closed");
    expect(screen.getByRole("option", { name: /2024-25/ })).toHaveTextContent("Closed");
  });

  it("writes the empty URL default when the current session is picked", async () => {
    const onChange = jest.fn();
    renderWithProviders(
      <SessionPicker sessions={SESSIONS} value="sess-closed" onChange={onChange} />,
    );

    await openPicker();
    await userEvent.click(await screen.findByRole("option", { name: /2026-27/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("writes the session's id when any other session is picked", async () => {
    const onChange = jest.fn();
    renderWithProviders(<SessionPicker sessions={SESSIONS} value="" onChange={onChange} />);

    await openPicker();
    await userEvent.click(await screen.findByRole("option", { name: /2025-26/ }));

    expect(onChange).toHaveBeenCalledWith("sess-closed");
  });

  it("shows the placeholder when no session is resolved yet", () => {
    renderWithProviders(<SessionPicker sessions={undefined} value="" onChange={jest.fn()} />);

    expect(screen.getByRole("combobox", { name: "Academic session" })).toHaveTextContent(
      "Select a session",
    );
  });
});
