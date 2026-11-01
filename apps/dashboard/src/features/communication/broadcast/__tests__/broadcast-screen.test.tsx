import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test-utils";

import { BroadcastScreen } from "../broadcast-screen";
import {
  CLASS_ID,
  fetchCampuses,
  fetchClasses,
  fetchSections,
  preview,
  previewRecord,
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
});
