import { screen, waitFor, within } from "@testing-library/react";

import type * as HelpersModule from "@/lib/helpers";
import { downloadFile } from "@/lib/helpers";
import {
  cursorPage,
  FILE_ID,
  messageRecord,
  SIGNED_URL,
  THREAD_ID,
} from "@/test-fixtures/communication";

import {
  CLOSE_THREAD,
  CREATE_MESSAGE,
  downloadAttachment,
  markRead,
  OVERSEE,
  oversightDownloadAttachment,
  oversightListMessages,
  renderOversight,
  stubOversight,
} from "../../messages/__tests__/messages-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/services", () =>
  jest
    .requireActual<{ communicationServicesMock: () => unknown }>("@/test-fixtures/communication")
    .communicationServicesMock(),
);

jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<typeof HelpersModule>("@/lib/helpers"),
  downloadFile: jest.fn(),
}));

// An overseer who also holds every inbox key: read-only comes from the screen, not the keys.
const EVERY_KEY = [OVERSEE, CREATE_MESSAGE, CLOSE_THREAD] as const;

describe("OversightScreen", () => {
  it("oversight view never calls markRead and shows audit banner", async () => {
    stubOversight([...EVERY_KEY]);
    await renderOversight();

    expect(await screen.findByText(/recorded in the audit log/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Fee query" })).toBeInTheDocument();
    await screen.findByRole("list", { name: "Messages" });

    expect(markRead).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Reply")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close conversation" })).not.toBeInTheDocument();
  });

  it("shows internal notes with their badge", async () => {
    stubOversight([OVERSEE]);
    oversightListMessages.mockResolvedValue(
      cursorPage([messageRecord({ body: "Do not share with the family", is_internal_note: true })]),
    );
    await renderOversight();

    const list = await screen.findByRole("list", { name: "Messages" });
    const [note] = await within(list).findAllByRole("listitem");

    expect(note).toHaveTextContent("Do not share with the family");
    expect(note).toHaveTextContent("Internal note");
  });

  it("downloads an attachment through the audited oversight endpoint", async () => {
    stubOversight([OVERSEE]);
    oversightListMessages.mockResolvedValue(
      cursorPage([messageRecord({ attachments: [FILE_ID] })]),
    );
    oversightDownloadAttachment.mockResolvedValue({ download_url: SIGNED_URL });
    const { user } = await renderOversight();

    await user.click(await screen.findByRole("button", { name: "Attachment 1" }));

    await waitFor(() => {
      expect(oversightDownloadAttachment).toHaveBeenCalledWith(THREAD_ID, FILE_ID);
    });
    expect(downloadFile).toHaveBeenCalledWith(SIGNED_URL);
    expect(downloadAttachment).not.toHaveBeenCalled();
  });
});
