import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { BroadcastScreen } from "../broadcast-screen";
import {
  CLASS_ID,
  fetchCampuses,
  fetchClasses,
  fetchJob,
  fetchSections,
  jobRecord,
  JOB_ID,
  keyOfCall,
  preview,
  previewRecord,
  send,
} from "./broadcast-test-support";

jest.mock("@/services", () =>
  jest
    .requireActual<{ broadcastServicesMock: () => unknown }>("./broadcast-services-mock")
    .broadcastServicesMock(),
);

describe("BroadcastScreen", () => {
  beforeEach(() => {
    fetchCampuses.mockResolvedValue([]);
    fetchClasses.mockResolvedValue([{ id: CLASS_ID, name: "Class 5" }]);
    fetchSections.mockResolvedValue([]);
    preview.mockResolvedValue(previewRecord());
  });

  it("class audience requires at least one class", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BroadcastScreen />);

    await user.click(screen.getByRole("radio", { name: "Specific classes" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Choose at least one class.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();

    await user.click(await screen.findByRole("checkbox", { name: "Class 5" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
  });

  it("counts the message against the API's limit and previews the built request", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BroadcastScreen />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(await screen.findByLabelText("Message"), "Closed");
    expect(screen.getByText("6 / 1000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("3 recipients")).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({ audience_type: "all", message: "Closed" });
  });

  it("keeps the idempotency key when the sender goes Back and Next after a failed send", async () => {
    send
      .mockRejectedValueOnce(
        new ApiError({
          code: "network_error",
          message: "Timed out.",
          status: 0,
          url: "/broadcasts:emergency",
        }),
      )
      .mockRejectedValueOnce(
        new ApiError({
          code: "network_error",
          message: "Timed out.",
          status: 0,
          url: "/broadcasts:emergency",
        }),
      );
    const user = userEvent.setup();
    renderWithProviders(<BroadcastScreen />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(await screen.findByLabelText("Message"), "Closed");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(await screen.findByLabelText(/Type 3 to confirm/), "3");
    await user.click(screen.getByRole("button", { name: "Send emergency broadcast" }));
    await screen.findByText("We could not reach the server. Check your connection.");

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await user.type(await screen.findByLabelText(/Type 3 to confirm/), "3");
    await user.click(screen.getByRole("button", { name: "Send emergency broadcast" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });

    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it("enables Back again on a new broadcast after a send was queued", async () => {
    send.mockResolvedValueOnce({ job_id: JOB_ID, status: "queued" });
    fetchJob.mockResolvedValue(jobRecord());
    const user = userEvent.setup();
    renderWithProviders(<BroadcastScreen />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(await screen.findByLabelText("Message"), "Closed");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(await screen.findByLabelText(/Type 3 to confirm/), "3");
    await user.click(screen.getByRole("button", { name: "Send emergency broadcast" }));
    await user.click(await screen.findByRole("button", { name: "Send another" }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Back" })).toBeEnabled();
    await user.type(screen.getByLabelText("Message"), "Open again");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("3 recipients");
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
  });
});
