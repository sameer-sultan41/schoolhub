import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { ConfirmStep } from "../confirm-step";
import { useBroadcastKey } from "../use-broadcast-key";
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

// The server's sentences: `broadcasts/services/scope.py` and `broadcasts/services/preview.py`.
const CAMPUS_REQUIRED =
  "Your access is limited to particular campuses: choose one of them as campus_id.";
const EMPTY_AUDIENCE =
  "This audience resolves to zero recipients. Broaden the targeting before broadcasting.";

/** A `DomainRuleViolation` as the envelope carries it: one detail, its sentence as the message. */
function refusal(field: string, issue: string, url: string) {
  return new ApiError({
    code: "domain_rule_violation",
    message: issue,
    status: 422,
    url,
    details: [{ field, issue }],
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

const noop = () => undefined;

function Host({ onQueued }: { onQueued: (jobId: string) => void }) {
  const broadcastKey = useBroadcastKey();
  return (
    <ConfirmStep
      request={REQUEST}
      onQueued={onQueued}
      broadcastKey={broadcastKey}
      onSendingChange={noop}
    />
  );
}

function renderConfirm() {
  const onQueued = jest.fn();
  renderWithProviders(<Host onQueued={onQueued} />);
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

    expect(await screen.findByText("In-app")).toBeInTheDocument();
    expect(screen.getByText("SMS: not delivered, no provider")).toBeInTheDocument();
  });

  it("accepts a count typed with grouping separators", async () => {
    preview.mockResolvedValue(previewRecord({ recipient_count: 15000 }));
    const { user } = renderConfirm();

    await user.type(await screen.findByLabelText(/Type 15000 to confirm/), "15,000");

    expect(screen.getByRole("button", { name: SEND })).toBeEnabled();
  });

  it("accepts a count typed in Urdu digits", async () => {
    preview.mockResolvedValue(previewRecord({ recipient_count: 42 }));
    const { user } = renderConfirm();

    await user.type(await screen.findByLabelText(/Type 42 to confirm/), "۴۲");

    expect(screen.getByRole("button", { name: SEND })).toBeEnabled();
  });

  it("shows the campus refusal's own sentence and previews again on retry", async () => {
    preview
      .mockRejectedValueOnce(refusal("campus_id", CAMPUS_REQUIRED, "/broadcasts:preview"))
      .mockResolvedValueOnce(previewRecord());
    const { user } = renderConfirm();

    expect(await screen.findByText(CAMPUS_REQUIRED)).toBeInTheDocument();
    expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText(/Type 3 to confirm/)).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it("shows the empty-audience refusal's own sentence at preview", async () => {
    preview.mockRejectedValue(refusal("non_field", EMPTY_AUDIENCE, "/broadcasts:preview"));
    renderConfirm();

    expect(await screen.findByText(EMPTY_AUDIENCE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SEND })).not.toBeInTheDocument();
  });

  it("shows the empty-audience refusal's own sentence when a send is refused", async () => {
    send.mockRejectedValueOnce(refusal("non_field", EMPTY_AUDIENCE, "/broadcasts:emergency"));
    const { user } = renderConfirm();

    await user.type(await screen.findByLabelText(/Type 3 to confirm/), "3");
    await user.click(screen.getByRole("button", { name: SEND }));

    expect(await screen.findByText(EMPTY_AUDIENCE)).toBeInTheDocument();
    expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
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
