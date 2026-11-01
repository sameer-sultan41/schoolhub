import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/services";
import { pick } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { BroadcastScreen } from "../broadcast-screen";
import {
  CLASS_ID,
  EAST,
  fetchCampuses,
  fetchClasses,
  fetchJob,
  fetchScope,
  fetchSections,
  GONE_CAMPUS_ID,
  jobRecord,
  JOB_ID,
  keyOfCall,
  NORTH,
  preview,
  previewRecord,
  send,
  SOUTH,
} from "./broadcast-test-support";

jest.mock("@/services", () =>
  jest
    .requireActual<{ broadcastServicesMock: () => unknown }>("./broadcast-services-mock")
    .broadcastServicesMock(),
);

const NO_CAMPUS = /Your access doesn't reach any campus/;

/** Renders the wizard and waits for the sender's scope, which Next waits for too. */
async function renderBroadcast() {
  const user = userEvent.setup();
  renderWithProviders(<BroadcastScreen />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
  return user;
}

describe("BroadcastScreen", () => {
  beforeEach(() => {
    fetchScope.mockResolvedValue({ campus_ids: null });
    fetchCampuses.mockResolvedValue([]);
    fetchClasses.mockResolvedValue([{ id: CLASS_ID, name: "Class 5" }]);
    fetchSections.mockResolvedValue([]);
    preview.mockResolvedValue(previewRecord());
  });

  it("class audience requires at least one class", async () => {
    const user = await renderBroadcast();

    await user.click(screen.getByRole("radio", { name: "Specific classes" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Choose at least one class.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();

    await user.click(await screen.findByRole("checkbox", { name: "Class 5" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
  });

  it("counts the message against the API's limit and previews the built request", async () => {
    const user = await renderBroadcast();

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
    const user = await renderBroadcast();

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
    const user = await renderBroadcast();

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

  describe("a campus-restricted sender", () => {
    beforeEach(() => {
      fetchCampuses.mockResolvedValue([NORTH, SOUTH, EAST]);
    });

    it("is offered only their own campuses, never all of them", async () => {
      fetchScope.mockResolvedValue({ campus_ids: [NORTH.id, SOUTH.id, GONE_CAMPUS_ID] });
      const user = await renderBroadcast();

      await user.click(screen.getByRole("combobox", { name: "Campus" }));
      const offered = await screen.findAllByRole("option");
      expect(offered.map((option) => option.textContent)).toEqual([NORTH.name, SOUTH.name]);
    });

    it("cannot leave the audience step until a campus is chosen", async () => {
      fetchScope.mockResolvedValue({ campus_ids: [NORTH.id, SOUTH.id] });
      const user = await renderBroadcast();

      await user.click(screen.getByRole("button", { name: "Next" }));
      expect(await screen.findByText("Choose one of your campuses.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();

      await pick(user, "Campus", SOUTH.name);
      await user.click(screen.getByRole("button", { name: "Next" }));
      await user.type(await screen.findByLabelText("Message"), "Closed");
      await user.click(screen.getByRole("button", { name: "Next" }));

      await screen.findByText("3 recipients");
      expect(preview).toHaveBeenCalledWith({
        audience_type: "all",
        message: "Closed",
        campus_id: SOUTH.id,
      });
    });

    it("has their only campus picked for them", async () => {
      fetchScope.mockResolvedValue({ campus_ids: [NORTH.id] });
      const user = await renderBroadcast();

      expect(screen.getByRole("combobox", { name: "Campus" })).toHaveTextContent(NORTH.name);
      await user.click(screen.getByRole("button", { name: "Next" }));
      await user.type(await screen.findByLabelText("Message"), "Closed");
      await user.click(screen.getByRole("button", { name: "Next" }));

      await screen.findByText("3 recipients");
      expect(preview).toHaveBeenCalledWith({
        audience_type: "all",
        message: "Closed",
        campus_id: NORTH.id,
      });
    });

    const unreachable: [string, string[]][] = [
      ["no campus at all", []],
      ["only a campus that no longer exists", [GONE_CAMPUS_ID]],
    ];
    it.each(unreachable)(
      "whose scope reaches %s is told so and cannot go on",
      async (_case, campusIds) => {
        fetchScope.mockResolvedValue({ campus_ids: campusIds });
        renderWithProviders(<BroadcastScreen />);

        expect(await screen.findByText(NO_CAMPUS)).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Campus" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
      },
    );
  });

  it("offers an unrestricted sender every campus, or all of them, and needs none", async () => {
    fetchCampuses.mockResolvedValue([NORTH, SOUTH]);
    const user = await renderBroadcast();

    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await screen.findByRole("option", { name: SOUTH.name });
    const offered = screen.getAllByRole("option");
    expect(offered.map((option) => option.textContent)).toEqual([
      "All campuses",
      NORTH.name,
      SOUTH.name,
    ]);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(screen.queryByText(NO_CAMPUS)).not.toBeInTheDocument();
  });
});
