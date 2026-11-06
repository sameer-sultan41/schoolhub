import { screen, waitFor } from "@testing-library/react";
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
      messageThreads: [
        "listThreads",
        "fetchThread",
        "listMessages",
        "markRead",
        "createThread",
        "postMessage",
      ],
      students: ["fetchStudentsPage"],
      files: ["uploadFile"],
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

    it("uploads a picked file and sends its id with the reply", async () => {
      await renderOpenThread("open");
      mocked(Services.files.uploadFile).mockResolvedValue("file-1");
      mocked(Services.messageThreads.postMessage).mockResolvedValue(messageRecord());
      const user = userEvent.setup();

      await user.upload(
        screen.getByLabelText("Attachments"),
        new File(["x"], "note.pdf", { type: "application/pdf" }),
      );
      await screen.findByText("note.pdf");
      await user.type(screen.getByRole("textbox", { name: "Reply" }), "See attached");
      await user.click(screen.getByRole("button", { name: "Send" }));

      expect(Services.files.uploadFile).toHaveBeenCalledWith(
        expect.any(File),
        "communication.thread-attachment",
      );
      await waitFor(() => {
        expect(Services.messageThreads.postMessage).toHaveBeenCalledWith(THREAD_ID, {
          body: "See attached",
          is_internal_note: false,
          attachments: ["file-1"],
        });
      });
    });

    it("refuses a file of a type the portal does not take, without uploading it", async () => {
      await renderOpenThread("open");
      const user = userEvent.setup({ applyAccept: false });

      await user.upload(
        screen.getByLabelText("Attachments"),
        new File(["x"], "run.exe", { type: "application/x-msdownload" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent("run.exe");
      expect(Services.files.uploadFile).not.toHaveBeenCalled();
    });

    it("shows no Reopen button on a closed conversation", async () => {
      await renderOpenThread("closed");

      expect(screen.getByText("This conversation is closed.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    });
  });
});
