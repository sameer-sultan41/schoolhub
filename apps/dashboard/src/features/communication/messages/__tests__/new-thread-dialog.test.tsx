import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  COLLEAGUE_ID,
  cursorPage,
  OTHER_COLLEAGUE_ID,
  STUDENT_ID,
  studentRecord,
  threadRecord,
} from "@/test-fixtures/communication";
import { pick } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { NewThreadDialog } from "../new-thread-dialog";
import { createThread, fetchStudentsPage, searchRecipients } from "./messages-test-support";

jest.mock("@/services", () =>
  jest
    .requireActual<{ communicationServicesMock: () => unknown }>("@/test-fixtures/communication")
    .communicationServicesMock(),
);

const GROUP = "Group (two or more colleagues)";

function renderDialog() {
  const onCreated = jest.fn();
  const onOpenChange = jest.fn();
  renderWithProviders(<NewThreadDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);
  return { onCreated, onOpenChange, user: userEvent.setup() };
}

describe("NewThreadDialog", () => {
  beforeEach(() => {
    searchRecipients.mockResolvedValue([
      { user_id: COLLEAGUE_ID, name: "Hira Noor", role: "Teacher" },
      { user_id: OTHER_COLLEAGUE_ID, name: "Omar Siddiqui", role: "Accountant" },
    ]);
    fetchStudentsPage.mockResolvedValue(cursorPage([studentRecord()]));
  });

  it("searches students and colleagues only once their picker opens", async () => {
    const { user } = renderDialog();
    expect(await screen.findByRole("button", { name: "Choose a student" })).toBeInTheDocument();
    expect(fetchStudentsPage).not.toHaveBeenCalled();
    expect(searchRecipients).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Choose a student" }));

    await waitFor(() => {
      expect(fetchStudentsPage).toHaveBeenCalledWith({ page: 1, pageSize: 10, search: "" });
    });
    expect(searchRecipients).not.toHaveBeenCalled();
  });

  it("group thread requires two participants", async () => {
    const { user } = renderDialog();
    await pick(user, "Conversation type", GROUP);

    await user.click(screen.getByRole("button", { name: "Add recipients" }));
    await user.click(await screen.findByRole("button", { name: /Hira Noor/ }));
    await user.type(screen.getByLabelText("Subject"), "Staff meeting");
    await user.type(screen.getByLabelText("First message"), "Friday at 2pm.");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    expect(
      await screen.findByText("Choose at least two colleagues for a group conversation."),
    ).toBeInTheDocument();
    expect(createThread).not.toHaveBeenCalled();
  });

  it("starts a group thread once two colleagues are chosen", async () => {
    createThread.mockResolvedValue(threadRecord({ thread_type: "group" }));
    const { user, onCreated } = renderDialog();
    await pick(user, "Conversation type", GROUP);

    await user.click(screen.getByRole("button", { name: "Add recipients" }));
    await user.click(await screen.findByRole("button", { name: /Hira Noor/ }));
    await user.click(await screen.findByRole("button", { name: /Omar Siddiqui/ }));
    await user.type(screen.getByLabelText("Subject"), "Staff meeting");
    await user.type(screen.getByLabelText("First message"), "Friday at 2pm.");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    await waitFor(() => {
      expect(createThread).toHaveBeenCalledWith({
        subject: "Staff meeting",
        thread_type: "group",
        body: "Friday at 2pm.",
        participant_user_ids: [COLLEAGUE_ID, OTHER_COLLEAGUE_ID],
      });
    });
    expect(onCreated).toHaveBeenCalledWith(threadRecord().id);
  });

  it("starts a guardian thread about the chosen student", async () => {
    createThread.mockResolvedValue(threadRecord());
    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Choose a student" }));
    await user.click(await screen.findByRole("button", { name: /Ayesha Khan/ }));
    await user.type(screen.getByLabelText("Subject"), "Fee query");
    await user.type(screen.getByLabelText("First message"), "About the term fee.");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    await waitFor(() => {
      expect(createThread).toHaveBeenCalledWith({
        subject: "Fee query",
        thread_type: "guardian_school",
        body: "About the term fee.",
        student_id: STUDENT_ID,
      });
    });
  });

  it("asks for a student before starting a guardian thread", async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText("Subject"), "Fee query");
    await user.type(screen.getByLabelText("First message"), "About the term fee.");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    expect(
      await screen.findByText("Choose the student this conversation is about."),
    ).toBeInTheDocument();
    expect(createThread).not.toHaveBeenCalled();
  });
});
