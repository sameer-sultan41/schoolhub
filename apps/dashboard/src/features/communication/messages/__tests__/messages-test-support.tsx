import type { ReactElement } from "react";
import type { PermissionKey } from "@schoolhub/types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  cursorPage,
  messageRecord,
  oversightRecord,
  THREAD_ID,
  threadRecord,
} from "@/test-fixtures/communication";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithClient, setUrl } from "@/test-utils";

import { OversightScreen } from "../../oversight/oversight-screen";
import { MessagesScreen } from "../messages-screen";

/** Shared setup for the Messages and Oversight tests; each file keeps its own `jest.mock` calls. */

export const fetchCurrentUser = mocked(Services.auth.fetchCurrentUser);
export const listThreads = mocked(Services.messageThreads.listThreads);
export const fetchThread = mocked(Services.messageThreads.fetchThread);
export const createThread = mocked(Services.messageThreads.createThread);
export const listMessages = mocked(Services.messageThreads.listMessages);
export const postMessage = mocked(Services.messageThreads.postMessage);
export const markRead = mocked(Services.messageThreads.markRead);
export const closeThread = mocked(Services.messageThreads.closeThread);
export const reopenThread = mocked(Services.messageThreads.reopenThread);
export const searchRecipients = mocked(Services.messageThreads.searchRecipients);
export const downloadAttachment = mocked(Services.messageThreads.downloadAttachment);
export const oversightListThreads = mocked(Services.threadOversight.listThreads);
export const oversightFetchThread = mocked(Services.threadOversight.fetchThread);
export const oversightListMessages = mocked(Services.threadOversight.listMessages);
export const oversightDownloadAttachment = mocked(Services.threadOversight.downloadAttachment);
export const fetchStudentsPage = mocked(Services.students.fetchStudentsPage);

export const VIEW: PermissionKey = "communication.thread.view";
export const CREATE_MESSAGE: PermissionKey = "communication.message.create";
export const CLOSE_THREAD: PermissionKey = "communication.thread.close";
export const CREATE_THREAD: PermissionKey = "communication.thread.create";
export const OVERSEE: PermissionKey = "communication.thread.oversee";

/** An open thread with one message from someone else: what every screen test starts from. */
export function stubInbox(permissions: PermissionKey[]) {
  fetchCurrentUser.mockResolvedValue(buildUser(permissions));
  listThreads.mockResolvedValue(cursorPage([threadRecord()]));
  fetchThread.mockResolvedValue(threadRecord());
  listMessages.mockResolvedValue(cursorPage([messageRecord()]));
  markRead.mockResolvedValue({ marked: 1 });
  searchRecipients.mockResolvedValue([]);
  fetchStudentsPage.mockResolvedValue(cursorPage([]));
}

/** The oversight twin of `stubInbox`: the same thread and message, read through oversight. */
export function stubOversight(permissions: PermissionKey[]) {
  fetchCurrentUser.mockResolvedValue(buildUser(permissions));
  oversightListThreads.mockResolvedValue(cursorPage([oversightRecord()]));
  oversightFetchThread.mockResolvedValue(oversightRecord());
  oversightListMessages.mockResolvedValue(cursorPage([messageRecord()]));
}

/** Opens `/communication/<screen>` with `?thread=` set, once the signed-in user has loaded. */
async function renderScreen(path: string, screenElement: ReactElement) {
  setUrl(`${path}?thread=${THREAD_ID}`);
  const { queryClient } = renderWithClient(
    <>
      <UserLoaded />
      {screenElement}
    </>,
  );
  await screen.findByText(USER_LOADED);
  return { user: userEvent.setup(), queryClient };
}

export const renderMessages = () => renderScreen("/communication/messages", <MessagesScreen />);
export const renderOversight = () => renderScreen("/communication/oversight", <OversightScreen />);
