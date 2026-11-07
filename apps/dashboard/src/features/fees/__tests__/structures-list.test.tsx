import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders, setUrl } from "@/test-utils";

import { StructuresHome } from "@/features/fees/structures/structures-home";
import {
  asUser,
  CAMPUS_ID,
  createFeeStructure,
  cursorPage,
  listFeeStructures,
  listFeeHeads,
  rowOf,
  SESSION_ID,
  scheduleRecord,
  stubFeesServices,
  structureRecord,
  STRUCTURE_ID,
  urlParam,
} from "./fees-test-support";

const mockPush = jest.fn();

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => object }>("@/test-utils");
  return { ...testUtils.createNavigationMock(), useRouter: () => ({ push: mockPush }) };
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ feesServicesMock: () => unknown }>("./fees-services-mock")
    .feesServicesMock(),
);

const ACTIVE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A draft with no schedules, and an active one at the north campus with one. */
function twoStructures() {
  return cursorPage([
    structureRecord(),
    structureRecord({
      id: ACTIVE_ID,
      name: "Grade 2 fees",
      campus: CAMPUS_ID,
      status: "active",
      schedules: [scheduleRecord()],
    }),
  ]);
}

async function renderHome() {
  renderWithProviders(
    <>
      <UserLoaded />
      <StructuresHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("structures page", () => {
  beforeEach(() => {
    stubFeesServices();
    listFeeStructures.mockResolvedValue(twoStructures());
  });

  it("lists each structure with its scope, schedule count, status and a link to its page", async () => {
    asUser(
      "fees.fee-structure.view",
      "school.academic-session.view",
      "school.class.view",
      "school.campus.view",
    );
    await renderHome();

    await screen.findByText("Grade 2 fees");
    const draft = rowOf("Grade 1 fees");
    expect(draft.getByText("2026-27")).toBeInTheDocument();
    expect(draft.getByText("Grade 1")).toBeInTheDocument();
    expect(draft.getByText("Every campus")).toBeInTheDocument();
    expect(draft.getByText("Draft")).toBeInTheDocument();
    expect(draft.getByRole("link", { name: "Grade 1 fees" })).toHaveAttribute(
      "href",
      `/fees/structures/${STRUCTURE_ID}`,
    );
    const active = rowOf("Grade 2 fees");
    expect(active.getByText("North campus")).toBeInTheDocument();
    expect(active.getByText("Active")).toBeInTheDocument();
    expect(active.getByText("1")).toBeInTheDocument();
  });

  it("offers no write to a viewer holding only the view key", async () => {
    asUser("fees.fee-structure.view");
    await renderHome();

    await screen.findByText("Grade 1 fees");
    expect(screen.queryByRole("button", { name: "New fee structure" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("offers Edit only on a draft, to a holder of the update key", async () => {
    asUser("fees.fee-structure.view", "fees.fee-structure.update");
    await renderHome();

    await screen.findByText("Grade 2 fees");
    expect(screen.getByRole("button", { name: "Edit Grade 1 fees" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Grade 2 fees" })).not.toBeInTheDocument();
  });

  it("filters by status through the URL", async () => {
    asUser("fees.fee-structure.view");
    const user = await renderHome();
    await screen.findByText("Grade 1 fees");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Active" }));

    await waitFor(() => {
      expect(urlParam("status")).toBe("active");
    });
    expect(listFeeStructures).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "active" }),
    );
  });

  it("creates a structure and opens its page", async () => {
    asUser(
      "fees.fee-structure.view",
      "fees.fee-structure.create",
      "school.academic-session.view",
      "school.class.view",
      "school.campus.view",
    );
    createFeeStructure.mockResolvedValue(structureRecord());
    const user = await renderHome();

    await user.click(screen.getByRole("button", { name: "New fee structure" }));
    const dialog = await screen.findByRole("dialog", { name: "New fee structure" });
    await user.type(within(dialog).getByLabelText("Name"), "Grade 3 fees");
    await user.click(await within(dialog).findByRole("combobox", { name: "Session" }));
    await user.click(await screen.findByRole("option", { name: "2026-27" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createFeeStructure).toHaveBeenCalledWith({
        name: "Grade 3 fees",
        academicSessionId: SESSION_ID,
        classId: null,
        campusId: null,
      });
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(`/fees/structures/${STRUCTURE_ID}`);
    });
  });

  it("switches to the Fee heads tab through ?tab= and drops the structure filters", async () => {
    asUser("fees.fee-structure.view");
    setUrl("/fees/structures?status=active");
    const user = await renderHome();
    await screen.findByText("Grade 1 fees");

    await user.click(screen.getByRole("tab", { name: "Fee heads" }));

    await waitFor(() => {
      expect(urlParam("tab")).toBe("heads");
    });
    expect(urlParam("status")).toBeNull();
    await waitFor(() => {
      expect(listFeeHeads).toHaveBeenCalled();
    });
  });
});
