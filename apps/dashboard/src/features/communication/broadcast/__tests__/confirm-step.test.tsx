import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { ConfirmStep } from "../confirm-step";
import { JOB_ID, keyOfCall, preview, previewRecord, REQUEST, send } from "./broadcast-test-support";

jest.mock("@/services", () =>
  jest
    .requireActual<{ broadcastServicesMock: () => unknown }>("./broadcast-services-mock")
    .broadcastServicesMock(),
);

const SEND = "Send emergency broadcast";

function audienceChanged() {
  return new ApiError({
    code: "audience_changed",
    message: "The audience changed.",
    status: 409,
    url: "/broadcasts:emergency",
    meta: { recipient_count: 5, audience_digest: "digest-2" },
  });
}

function serverError() {
  return new ApiError({
    code: "server_error",
    message: "Something broke.",
    status: 500,
    url: "/broadcasts:emergency",
  });
}

function renderConfirm() {
  const onQueued = jest.fn();
  renderWithProviders(<ConfirmStep request={REQUEST} onQueued={onQueued} />);
  return { onQueued, user: userEvent.setup() };
}

describe("ConfirmStep", () => {
  beforeEach(() => {
    preview.mockResolvedValue(previewRecord());
  });

  it("send disabled until typed count matches preview", async () => {
    const { user } = renderConfirm();
    const sendButton = await screen.findByRole("button", { name: SEND });
    const input = screen.getByLabelText(/Type 3 to confirm/);
    expect(sendButton).toBeDisabled();

    await user.type(input, "2");
    expect(sendButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, "3");
    expect(sendButton).toBeEnabled();
  });

  it("unavailable channels render as not delivered", async () => {
    renderConfirm();

    expect(await screen.findByText("in_app")).toBeInTheDocument();
    expect(screen.getByText("sms: not delivered, no provider")).toBeInTheDocument();
  });

  it("409 audience_changed re-previews and clears confirmation", async () => {
    preview
      .mockResolvedValueOnce(previewRecord())
      .mockResolvedValueOnce(previewRecord({ recipient_count: 5, audience_digest: "digest-2" }));
    send.mockRejectedValueOnce(audienceChanged());
    const { user } = renderConfirm();

    await user.type(await screen.findByLabelText(/Type 3 to confirm/), "3");
    await user.click(screen.getByRole("button", { name: SEND }));

    expect(await screen.findByText(/now has 5 recipients/)).toBeInTheDocument();
    const input = await screen.findByLabelText(/Type 5 to confirm/);
    expect(input).toHaveValue("");
    expect(preview).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: SEND })).toBeDisabled();
  });

  it("retry reuses the same idempotency key; a new preview mints a new one", async () => {
    preview
      .mockResolvedValueOnce(previewRecord())
      .mockResolvedValueOnce(previewRecord({ recipient_count: 5, audience_digest: "digest-2" }));
    send
      .mockRejectedValueOnce(serverError())
      .mockRejectedValueOnce(audienceChanged())
      .mockResolvedValueOnce({ job_id: JOB_ID, status: "queued" });
    const { user, onQueued } = renderConfirm();

    await user.type(await screen.findByLabelText(/Type 3 to confirm/), "3");
    await user.click(screen.getByRole("button", { name: SEND }));
    await screen.findByText("Something went wrong on our side. The team has been notified.");
    await user.click(screen.getByRole("button", { name: SEND }));
    await screen.findByLabelText(/Type 5 to confirm/);
    await user.type(screen.getByLabelText(/Type 5 to confirm/), "5");
    await user.click(screen.getByRole("button", { name: SEND }));

    await waitFor(() => {
      expect(onQueued).toHaveBeenCalledWith(JOB_ID);
    });
    expect(typeof keyOfCall(0)).toBe("string");
    expect(keyOfCall(1)).toBe(keyOfCall(0));
    expect(keyOfCall(2)).not.toBe(keyOfCall(1));
  });
});
