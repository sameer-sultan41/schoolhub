import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { StudentRecord } from "@/services";
import { renderWithProviders, setMatchesMobile } from "@/test-utils";

import { StudentDetailSheet } from "../student-detail-sheet";
import type { StudentRow } from "@/services/modules/students/students-type";

jest.mock("@/services", () => ({
  Services: {
    students: {
      fetchStudentById: jest.fn(),
    },
  },
}));

const mockFetchStudentById = Services.students.fetchStudentById as jest.MockedFunction<
  typeof Services.students.fetchStudentById
>;

function studentRow(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: "stu-1",
    // Deliberately different from `studentDetail()`'s own `admission_number` default
    // below — this field renders twice (the row's own header, and the fetched detail's
    // field row), and a shared default would make `findByText` on this value ambiguous
    // ("found multiple elements") in every test that merely uses it as a load signal,
    // not just the one test that is actually about the row-vs-fetched distinction.
    admissionNumber: "2026-0001",
    name: "Aisha Khan",
    status: "active",
    campus: "Main Campus",
    house: "Blue House",
    admissionDate: "2026-01-10",
    updatedAt: "2026-09-20T00:00:00Z",
    signedPhotoUrl: undefined,
    ...overrides,
  };
}

// Typed from fetchStudentById so the fixture tracks what it actually returns. Every
// nullable field defaults to a real, non-null value — deliberately, so a test that
// overrides exactly one field to `null` (the em-dash test below) can assert `getByText`
// (singular) against "—" without a sibling field's own default null also rendering one.
function studentDetail(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: "stu-1",
    admission_number: "2026-0050",
    first_name: "Aisha",
    last_name: "Khan",
    preferred_name: "Ash",
    date_of_birth: "2015-03-12",
    gender: "female",
    photo_file_id: null,
    photo_url: null,
    campus_id: "campus-1",
    campus_name: "Main Campus",
    house_id: "house-1",
    house_name: "Blue House",
    status: "active",
    admission_date: "2026-01-10",
    blood_group: "O+",
    nationality: "Pakistani",
    religion: "Islam",
    previous_school: "City Grammar School",
    medical_notes: "No known allergies.",
    address: null,
    custom_fields: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

describe("StudentDetailSheet", () => {
  beforeEach(() => {
    mockFetchStudentById.mockReset();
  });

  it("shows Restricted only when medical_notes is genuinely absent from the response", async () => {
    const { medical_notes: _omit, ...withoutMedicalNotes } = studentDetail();
    mockFetchStudentById.mockResolvedValue(withoutMedicalNotes);

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow()}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    expect(await screen.findByText("Restricted")).toBeInTheDocument();
  });

  it("shows the fetched admission number from the detail response, not just the row's own", async () => {
    // Distinct values for the row (what opened the sheet) and the detail response (what
    // it fetches) — if this test used the same number for both, it would pass whether or
    // not the field row actually renders `data`, which is the one thing it's meant to
    // prove (round-3 review finding).
    mockFetchStudentById.mockResolvedValue(studentDetail({ admission_number: "2026-0099" }));

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow({ admissionNumber: "2026-0001" })}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    expect(await screen.findByText("2026-0099")).toBeInTheDocument();
  });

  it("shows last-updated as relative time, not a raw timestamp, and no half-label while loading", async () => {
    let resolveDetail: (record: StudentRecord) => void = () => {};
    mockFetchStudentById.mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve;
      }),
    );

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow()}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    // Still loading: a skeleton, never "Last updated " with nothing after it.
    expect(screen.queryByText(/last updated/i)).not.toBeInTheDocument();

    resolveDetail(studentDetail({ updated_at: "2026-09-20T00:00:00Z" }));

    // `formatDistanceToNow` with `addSuffix` — "… ago", or "in …" on a runner whose clock
    // reads earlier than the fixture date.
    expect(await screen.findByText(/^Last updated (in .+|.+ ago)$/)).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-20T00:00:00Z/)).not.toBeInTheDocument();
  });

  it("shows a real medical_notes value as itself, not as Restricted, when the key is present but falsy-looking", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail({ medical_notes: "No known allergies." }));

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow()}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    expect(await screen.findByText("No known allergies.")).toBeInTheDocument();
    expect(screen.queryByText("Restricted")).not.toBeInTheDocument();
  });

  it("shows an em dash, not Restricted, when medical_notes is present and genuinely null (a viewer who CAN see it, but there's simply nothing on file)", async () => {
    // Distinct from the "genuinely absent" test above: `null` means the key survived
    // `to_representation` (the viewer has visibility) but the student has no notes,
    // which must read differently from "you can't see this" — an implementation that
    // uses `??`/truthiness instead of the `"medical_notes" in data` check would show
    // "Restricted" here too, incorrectly (round-4 review finding).
    mockFetchStudentById.mockResolvedValue(studentDetail({ medical_notes: null }));

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow()}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    // `studentRow().admissionNumber` renders synchronously from the row prop, before the
    // detail fetch resolves — it's not a usable "data has loaded" signal here. Wait on
    // the em dash itself instead: it can only appear once the FieldRow has actually
    // left its loading-skeleton state.
    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Restricted")).not.toBeInTheDocument();
  });

  it("hides the Withdraw action for a non-active student even when canWithdraw is true", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail({ status: "graduated" }));

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow({ status: "graduated" })}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    await screen.findByText(/graduated/i);
    expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
  });

  it("shows the Withdraw action for an active student when canWithdraw is true (positive control)", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail({ status: "active" }));

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow({ status: "active" })}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    await screen.findByText(/active/i);
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeInTheDocument();
  });

  it("hides Edit when canUpdate is false", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail());

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow()}
        canUpdate={false}
        canWithdraw={false}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    await screen.findByText(studentRow().admissionNumber);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("calls onEdit with the row's id when the footer's Edit button is clicked", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail());
    const onEdit = jest.fn();

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow({ id: "stu-9" })}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={onEdit}
        onWithdraw={jest.fn()}
      />,
    );

    await userEvent.setup().click(await screen.findByRole("button", { name: /^edit$/i }));

    expect(onEdit).toHaveBeenCalledWith("stu-9");
  });

  it("calls onWithdraw with the row's id and name when the footer's Withdraw button is clicked", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail({ status: "active" }));
    const onWithdraw = jest.fn();

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow({ id: "stu-9", name: "Ayesha Khan", status: "active" })}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={onWithdraw}
      />,
    );

    await userEvent.setup().click(await screen.findByRole("button", { name: /^withdraw$/i }));

    expect(onWithdraw).toHaveBeenCalledWith("stu-9", "Ayesha Khan");
  });
});

describe("StudentDetailSheet — mobile drawer", () => {
  beforeEach(() => {
    setMatchesMobile(true);
    mockFetchStudentById.mockReset();
  });

  afterEach(() => {
    setMatchesMobile(false);
  });

  it("renders as a Drawer with icon-only actions, found by their full accessible name", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail({ status: "active" }));
    const onEdit = jest.fn();
    const onWithdraw = jest.fn();

    // `baseElement`, not `container`: the Drawer portals its content to `document.body`,
    // a sibling of `container` — `container.querySelector` can't reach it.
    const { baseElement } = renderWithProviders(
      <StudentDetailSheet
        row={studentRow({ id: "stu-9", name: "Ayesha Khan", status: "active" })}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={onEdit}
        onWithdraw={onWithdraw}
      />,
    );
    await screen.findByText(studentRow().admissionNumber);

    expect(baseElement.querySelector('[data-slot="drawer-content"]')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith("stu-9");

    await user.click(screen.getByRole("button", { name: "Withdraw Ayesha Khan" }));
    expect(onWithdraw).toHaveBeenCalledWith("stu-9", "Ayesha Khan");
  });
});
