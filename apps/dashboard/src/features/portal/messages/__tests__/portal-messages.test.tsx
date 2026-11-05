import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { cursorPage, messageRecord, THREAD_ID, threadRecord } from "@/test-fixtures/communication";
import { mocked } from "@/test-fixtures/list-screen";
import { portalDashboard } from "@/test-fixtures/portal";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithClient, setUrl } from "@/test-utils";

import { PortalMessages } from "../portal-messages";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({
      auth: ["fetchCurrentUser"],
      parentPortal: ["fetchPortalDashboard"],
      messageThreads: ["listThreads", "fetchThread", "listMessages", "markRead", "createThread"],
      students: ["fetchStudentsPage"],
    }),
);

describe("PortalMessages", () => {
  it("portal messages limit student picker to own children", async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["communication.thread.view", "communication.thread.create"]),
    );
    mocked(Services.parentPortal.fetchPortalDashboard).mockResolvedValue(portalDashboard());
    mocked(Services.messageThreads.listThreads).mockResolvedValue(cursorPage([threadRecord()]));
    setUrl("/portal/messages");
    const user = userEvent.setup();

    renderWithClient(
      <>
        <UserLoaded />
        <PortalMessages />
      </>,
    );
    await screen.findByText(USER_LOADED);
    await user.click(await screen.findByRole("button", { name: "New conversation" }));

    // No conversation type and no recipient picker: it is always a guardian-school thread.
    expect(screen.queryByText("Conversation type")).not.toBeInTheDocument();
    expect(screen.queryByText("Recipients")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("combobox", { name: "Student" }));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Ayesha Khan", "Bilal Khan"]);
    // The staff picker's student search is never reached.
    expect(Services.students.fetchStudentsPage).not.toHaveBeenCalled();
  });

  describe("an open conversation", () => {
    async function renderOpenThread(status: "open" | "closed") {
      mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
        buildUser([
          "communication.thread.view",
          "communication.message.create",
          "communication.thread.close",
        ]),
      );
      mocked(Services.parentPortal.fetchPortalDashboard).mockResolvedValue(portalDashboard());
      mocked(Services.messageThreads.listThreads).mockResolvedValue(
        cursorPage([threadRecord({ status })]),
      );
      mocked(Services.messageThreads.fetchThread).mockResolvedValue(threadRecord({ status }));
      mocked(Services.messageThreads.listMessages).mockResolvedValue(cursorPage([messageRecord()]));
      mocked(Services.messageThreads.markRead).mockResolvedValue({ marked: 0 });
      setUrl(`/portal/messages?thread=${THREAD_ID}`);
      renderWithClient(
        <>
          <UserLoaded />
          <PortalMessages />
        </>,
      );
      await screen.findByText(USER_LOADED);
      await screen.findByRole("article", { name: "Fee query" });
    }

    it("shows no Close button even to a user holding the close permission", async () => {
      await renderOpenThread("open");

      expect(screen.getByRole("textbox", { name: "Reply" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Close conversation" })).not.toBeInTheDocument();
    });

    it("shows no Reopen button on a closed conversation", async () => {
      await renderOpenThread("closed");

      expect(screen.getByText("This conversation is closed.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    });
  });
});
