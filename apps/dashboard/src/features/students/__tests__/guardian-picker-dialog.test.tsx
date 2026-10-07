import { ApiError } from "@schoolhub/api-client";
import { Drawer, DrawerContent } from "@schoolhub/ui";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { GuardianRecord } from "@/services";
import { renderWithProviders, setMatchesMobile } from "@/test-utils";

import { GuardianPickerDialog } from "../guardian-picker-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    guardians: {
      searchGuardians: jest.fn(),
      createGuardian: jest.fn(),
      updateGuardian: jest.fn(),
      linkGuardianToStudent: jest.fn(),
    },
    files: { uploadFile: jest.fn() },
  },
}));

const mockSearchGuardians = Services.guardians.searchGuardians as jest.MockedFunction<
  typeof Services.guardians.searchGuardians
>;
const mockCreateGuardian = Services.guardians.createGuardian as jest.MockedFunction<
  typeof Services.guardians.createGuardian
>;
const mockLinkGuardianToStudent = Services.guardians.linkGuardianToStudent as jest.MockedFunction<
  typeof Services.guardians.linkGuardianToStudent
>;

function guardianRecord(overrides: Partial<GuardianRecord> = {}): GuardianRecord {
  return {
    id: "g1",
    user_id: null,
    first_name: "Ayesha",
    last_name: "Raza",
    phone: "0300-0000000",
    alt_phone: null,
    email: null,
    occupation: null,
    employer: null,
    national_id: null,
    photo_file_id: null,
    photo_url: null,
    address: null,
    custom_fields: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("GuardianPickerDialog", () => {
  const onOpenChange = jest.fn();
  const onLinked = jest.fn();

  beforeEach(() => {
    mockSearchGuardians.mockReset();
    mockCreateGuardian.mockReset();
    mockLinkGuardianToStudent.mockReset();
    onOpenChange.mockReset();
    onLinked.mockReset();
  });

  afterEach(() => {
    setMatchesMobile(false);
  });

  it("searches, selects a result, picks a relationship, and links", async () => {
    mockSearchGuardians.mockResolvedValue([guardianRecord()]);
    mockLinkGuardianToStudent.mockResolvedValue({ id: "link-1" } as never);
    const user = userEvent.setup();

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "Ayesha");
    await waitFor(() => {
      expect(mockSearchGuardians).toHaveBeenCalledWith("Ayesha");
    });
    // The results Select renders its options only once opened (Radix mounts
    // SelectContent in a portal on open) — the trigger's own accessible name is the
    // "search existing" tab label (the component's own comment on SelectTrigger explains
    // why), distinct from the plain-text search input above.
    await user.click(await screen.findByRole("combobox", { name: /search existing/i }));
    await user.click(await screen.findByRole("option", { name: /ayesha raza/i }));
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^mother$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));

    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({
          guardianId: "g1",
          relationship: "mother",
          isPrimary: false,
          isFeeResponsible: false,
          canPickUp: true,
          receivesCommunications: true,
          hasPortalAccess: true,
        }),
      );
    });
    expect(onLinked).toHaveBeenCalled();
  });

  it("shows no-results copy when a search matches nothing, with create-new still reachable", async () => {
    mockSearchGuardians.mockResolvedValue([]);
    const user = userEvent.setup();

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "Nobody");
    await waitFor(() => {
      expect(mockSearchGuardians).toHaveBeenCalledWith("Nobody");
    });
    // The real copy (Task 4, Step 5) — distinct from the Guardians tab's own
    // "No guardians linked yet." empty state and from common.noResults ("No records
    // found."), which belongs to table-style lists, not this search box.
    expect(await screen.findByText("No guardians match that search.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /create new/i })).toBeInTheDocument();
  });

  it("shows a search error state, distinct from the no-results copy, and clears it on retry", async () => {
    // Regression: `searchResults` used to derive straight from `searchQuery.data ?? []`
    // with no `isError` branch at all, so a failed search (network error, 5xx, or this
    // app's 60/min per-user rate limit) rendered the exact same "No guardians match that
    // search." empty-state copy as a genuine zero-result search. Guardians have no delete
    // endpoint, so a user misled by that into "Create new" creates a permanent,
    // unremovable duplicate record (round-7 review finding).
    mockSearchGuardians.mockRejectedValueOnce(new Error("network blip"));
    mockSearchGuardians.mockResolvedValueOnce([guardianRecord()]);
    const user = userEvent.setup();

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "Ayesha");
    await waitFor(() => {
      expect(mockSearchGuardians).toHaveBeenCalledWith("Ayesha");
    });

    expect(await screen.findByText("Couldn't search guardians.")).toBeInTheDocument();
    expect(screen.queryByText("No guardians match that search.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(mockSearchGuardians).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("Couldn't search guardians.")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("combobox", { name: /search existing/i }));
    expect(await screen.findByRole("option", { name: /ayesha raza/i })).toBeInTheDocument();
  });

  it("creates a new guardian from the inline create fields, then links it — and never re-creates on a link retry", async () => {
    mockCreateGuardian.mockResolvedValue(
      guardianRecord({ id: "g2", first_name: "Bilal", last_name: "Khan" }),
    );
    // First link attempt fails (e.g. a transient conflict); the user clicks "Link
    // guardian" again without the create step running a second time.
    mockLinkGuardianToStudent
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({ id: "link-2" } as never);
    const user = userEvent.setup();

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    // The create-new tab's own fields, inlined into this same dialog — no nested dialog
    // (packages/ui's ResponsiveDialog has no supported nested-drawer pattern on mobile).
    await user.click(screen.getByRole("tab", { name: /create new/i }));
    await user.type(await screen.findByLabelText(/first name/i), "Bilal");
    await user.type(screen.getByLabelText(/last name/i), "Khan");
    await user.type(screen.getByLabelText(/^phone$/i), "0300-2222222");
    await user.click(screen.getByRole("button", { name: /create guardian/i }));

    await waitFor(() => {
      expect(mockCreateGuardian).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: "Bilal", lastName: "Khan" }),
      );
    });
    // The dialog advances to its link step: the just-created guardian is shown as
    // selected, the tabs are gone, and only the relationship remains to be picked.
    expect(await screen.findByText("Bilal Khan")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /create new/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^father$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));
    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledTimes(1);
    });

    // Retry after the failure — createGuardian must not be called a second time.
    await user.click(screen.getByRole("button", { name: /link guardian/i }));
    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledTimes(2);
    });
    expect(mockCreateGuardian).toHaveBeenCalledTimes(1);
    expect(mockLinkGuardianToStudent).toHaveBeenLastCalledWith(
      "student-1",
      expect.objectContaining({ guardianId: "g2", relationship: "father" }),
    );
    expect(onLinked).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's real 409 when linking an already-linked guardian", async () => {
    mockSearchGuardians.mockResolvedValue([guardianRecord()]);
    // The real shape a duplicate link produces: StudentGuardian's UniqueConstraint ->
    // IntegrityError -> core/api/exceptions.py's 409 `conflict` mapping — not an
    // invented 422.
    mockLinkGuardianToStudent.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "The request conflicts with existing data.",
        status: 409,
        url: "/students/student-1/guardians",
        details: [{ field: "non_field", issue: "The request conflicts with existing data." }],
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "Ayesha");
    await user.click(await screen.findByRole("combobox", { name: /search existing/i }));
    await user.click(await screen.findByRole("option", { name: /ayesha raza/i }));
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^mother$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));

    expect(
      await screen.findByText("The request conflicts with existing data."),
    ).toBeInTheDocument();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("excludes already-linked guardians from search results", async () => {
    mockSearchGuardians.mockResolvedValue([
      guardianRecord({ id: "g1", first_name: "Ayesha" }),
      guardianRecord({ id: "g3", first_name: "Zainab" }),
    ]);
    const user = userEvent.setup();

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        excludedGuardianIds={["g1"]}
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "a");
    await waitFor(() => {
      expect(mockSearchGuardians).toHaveBeenCalled();
    });
    await user.click(await screen.findByRole("combobox", { name: /search existing/i }));
    expect(await screen.findByRole("option", { name: /zainab/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /ayesha/i })).not.toBeInTheDocument();
  });

  it("makes the first guardian linked primary by default", async () => {
    mockSearchGuardians.mockResolvedValue([guardianRecord()]);
    mockLinkGuardianToStudent.mockResolvedValue({ id: "link-1" } as never);
    const user = userEvent.setup();

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        isFirstGuardian
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "Ayesha");
    await user.click(await screen.findByRole("combobox", { name: /search existing/i }));
    await user.click(await screen.findByRole("option", { name: /ayesha raza/i }));
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^mother$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));

    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({ isPrimary: true }),
      );
    });
  });

  it("opens correctly on a mobile drawer nested inside the detail sheet's own drawer", () => {
    // This dialog always opens from inside StudentDetailSheet's own mobile Drawer
    // (Task 10) — proves `nested` is actually wired (Task 5, Part A), not just that the
    // dialog renders standalone, which every other test here already covers on desktop.
    setMatchesMobile(true);

    const { baseElement } = renderWithProviders(
      <Drawer open onOpenChange={jest.fn()}>
        <DrawerContent closeLabel="Close sheet">
          <GuardianPickerDialog
            open
            studentId="student-1"
            excludedGuardianIds={[]}
            isFirstGuardian
            onOpenChange={onOpenChange}
            onLinked={onLinked}
          />
        </DrawerContent>
      </Drawer>,
    );

    expect(baseElement.querySelectorAll('[data-slot="drawer-content"]')).toHaveLength(2);
  });
});
