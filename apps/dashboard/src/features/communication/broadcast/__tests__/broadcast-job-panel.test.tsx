import { screen } from "@testing-library/react";

import { renderWithProviders } from "@/test-utils";

import { BroadcastJobPanel } from "../broadcast-job-panel";
import { fetchJob, JOB_ID, jobRecord } from "./broadcast-test-support";

jest.mock("@/services", () =>
  jest
    .requireActual<{ broadcastServicesMock: () => unknown }>("./broadcast-services-mock")
    .broadcastServicesMock(),
);

describe("BroadcastJobPanel", () => {
  it("job panel shows succeeded result", async () => {
    fetchJob.mockResolvedValue(jobRecord());
    renderWithProviders(<BroadcastJobPanel jobId={JOB_ID} onDone={jest.fn()} />);

    expect(await screen.findByText("The broadcast was sent to 3 recipients.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send another" })).toBeInTheDocument();
  });

  it("shows the job's own error when it failed", async () => {
    fetchJob.mockResolvedValue(jobRecord({ status: "failed", result: null, error: "Queue down" }));
    renderWithProviders(<BroadcastJobPanel jobId={JOB_ID} onDone={jest.fn()} />);

    expect(await screen.findByText("Queue down")).toBeInTheDocument();
  });
});
