import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { StudentCreateStepper } from "../student-create-stepper";
import messages from "../../../../messages/en.json";

jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: jest.fn(),
}));
jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([{ id: "campus-1", name: "Main" }]) },
    schoolOrganization: {
      fetchHouses: jest.fn().mockResolvedValue([]),
      fetchClasses: jest.fn().mockResolvedValue([]),
      fetchSections: jest.fn().mockResolvedValue([]),
      fetchAcademicSessions: jest.fn().mockResolvedValue([]),
    },
    students: {
      createStudent: jest.fn(),
      fetchStudentHistory: jest.fn().mockResolvedValue([]),
    },
    // Without this, `StudentGuardiansTab`'s own `linksQuery` throws on
    // `Services.guardians.fetchGuardianLinks` being undefined and the tab renders its
    // error state instead of "Link guardian" — confirmed on CI, not assumed.
    guardians: { fetchGuardianLinks: jest.fn().mockResolvedValue([]) },
    studentTransfers: { fetchStudentTransfers: jest.fn().mockResolvedValue([]) },
  },
}));

import { useCurrentUser } from "@/hooks/use-current-user";

const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;
const mockCreateStudent = Services.students.createStudent as jest.MockedFunction<
  typeof Services.students.createStudent
>;

function userWith(permissions: string[]) {
  return {
    data: { id: "u1", permissions, tenant: "t1", email: "a@b.com" },
  } as never;
}

async function fillAndSubmitProfile() {
  await userEvent.type(screen.getByLabelText(/first name/i), "Ayesha");
  await userEvent.type(screen.getByLabelText(/last name/i), "Khan");
  await userEvent.type(screen.getByLabelText(/date of birth/i), "2012-05-01");
  await userEvent.type(screen.getByLabelText(/admission date/i), "2026-01-10");
  await userEvent.click(screen.getByRole("combobox", { name: /gender/i }));
  await userEvent.click(await screen.findByRole("option", { name: /female/i }));
  await userEvent.click(screen.getByRole("combobox", { name: /^campus$/i }));
  await userEvent.click(await screen.findByRole("option", { name: "Main" }));
  // The Profile step's primary submit button reads "Next" when a later step
  // exists, "Finish" otherwise (a viewer with only `students.student.create`) —
  // Profile also offers a separate outline "Finish" button once a later step
  // exists, so prefer "Next" and fall back to "Finish" rather than matching both.
  const nextButton = screen.queryByRole("button", { name: /^next$/i });
  await userEvent.click(nextButton ?? screen.getByRole("button", { name: /^finish$/i }));
}

describe("StudentCreateStepper", () => {
  beforeEach(() => {
    mockCreateStudent.mockReset();
    mockCreateStudent.mockResolvedValue({
      id: "student-1",
      campus_id: "campus-1",
      first_name: "Ayesha",
      last_name: "Khan",
    } as never);
  });

  it("shows Profile → Finish only for a viewer with just students.student.create (Review Focus #3)", async () => {
    mockUseCurrentUser.mockReturnValue(userWith(["students.student.create"]));
    renderWithProviders(<StudentCreateStepper open onOpenChange={jest.fn()} />);

    await fillAndSubmitProfile();

    expect(await screen.findByRole("button", { name: /^finish$/i })).toBeInTheDocument();
    expect(screen.queryByText(/guardians/i)).not.toBeInTheDocument();
  });

  it("shows the created-student banner once Profile succeeds", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create"]),
    );
    renderWithProviders(<StudentCreateStepper open onOpenChange={jest.fn()} />);

    await fillAndSubmitProfile();

    expect(await screen.findByText(/ayesha khan/i)).toBeInTheDocument();
  });

  it("lets Back return all the way to Profile, locked for review rather than resubmission", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create", "students.student.update"]),
    );
    renderWithProviders(<StudentCreateStepper open onOpenChange={jest.fn()} />);

    await fillAndSubmitProfile();
    // Now on Guardians (step 2) — Back is offered here too, unlike before.
    await userEvent.click(screen.getByRole("button", { name: /^previous$/i }));

    // Back on Profile: the entered values survived (the form never unmounted),
    // and every field is disabled — a revisit can't resubmit and create a
    // second student.
    expect(screen.getByLabelText(/first name/i)).toHaveValue("Ayesha");
    expect(screen.getByLabelText(/first name/i)).toBeDisabled();
    expect(mockCreateStudent).toHaveBeenCalledTimes(1);

    // Moving forward again is a plain step change, not a resubmit. Profile
    // itself is never unmounted (its own entered values have to survive a
    // trip back to it) — just hidden via a CSS class (`toBeVisible()` can't
    // see that in jsdom, which never loads the real stylesheet, so this
    // checks for Guardians' own content instead — remounted fresh on this
    // jump, same as "lets a step's own tab jump straight to it" below, hence
    // `findByRole`). A resubmit would be a second `createStudent` call.
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(await screen.findByRole("button", { name: /link guardian/i })).toBeInTheDocument();
    expect(mockCreateStudent).toHaveBeenCalledTimes(1);
  });

  it("lets a step's own tab jump straight to it, once already visited", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create", "students.student.update"]),
    );
    renderWithProviders(<StudentCreateStepper open onOpenChange={jest.fn()} />);

    await fillAndSubmitProfile();
    // Now on Guardians (step 2). Emergency Contacts' own tab (step 3) isn't
    // reachable yet — it's never been visited.
    expect(screen.getByRole("tab", { name: /emergency contacts/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    // Now on Emergency Contacts — Guardians' tab is behind us but still visited,
    // so it's enabled; clicking it jumps straight back.
    const guardiansTab = screen.getByRole("tab", { name: /guardians/i });
    expect(guardiansTab).toBeEnabled();
    await userEvent.click(guardiansTab);

    // Jumping back via the tab remounts `StudentGuardiansTab` fresh (its own
    // conditional render unmounted it on advancing to Emergency Contacts) — its
    // own data query needs a tick to resolve even when TanStack Query serves it
    // from cache, unlike the synchronous assertions elsewhere in this file that
    // never left and remounted this tab.
    expect(await screen.findByRole("button", { name: /link guardian/i })).toBeInTheDocument();
  });

  it("lets the user finish right from Profile, skipping every later step", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create", "students.student.update"]),
    );
    const onOpenChange = jest.fn();
    renderWithProviders(<StudentCreateStepper open onOpenChange={onOpenChange} />);

    await userEvent.type(screen.getByLabelText(/first name/i), "Ayesha");
    await userEvent.type(screen.getByLabelText(/last name/i), "Khan");
    await userEvent.type(screen.getByLabelText(/date of birth/i), "2012-05-01");
    await userEvent.type(screen.getByLabelText(/admission date/i), "2026-01-10");
    await userEvent.click(screen.getByRole("combobox", { name: /gender/i }));
    await userEvent.click(await screen.findByRole("option", { name: /female/i }));
    await userEvent.click(screen.getByRole("combobox", { name: /^campus$/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Main" }));

    await userEvent.click(screen.getByRole("button", { name: /^finish$/i }));

    await waitFor(() => {
      expect(mockCreateStudent).toHaveBeenCalledTimes(1);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lets the user finish immediately from a middle step instead of clicking Next through the rest", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create", "students.student.update"]),
    );
    const onOpenChange = jest.fn();
    renderWithProviders(<StudentCreateStepper open onOpenChange={onOpenChange} />);

    await fillAndSubmitProfile();
    // Now on Guardians (step 2 of 3) — a Finish button should be offered alongside
    // Next, since every step past Profile is optional.
    await userEvent.click(await screen.findByRole("button", { name: /^finish$/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("resets to a fresh wizard on reopen (Review Focus #4)", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create"]),
    );
    const onOpenChange = jest.fn();
    // Deliberately not `renderWithProviders`: its `rerender` swaps the ENTIRE tree for
    // whatever element it's given, providers included, so `rerender(<StudentCreateStepper
    // open={false} />)` would silently drop the `QueryClientProvider`/
    // `NextIntlClientProvider` and throw the moment `useTranslations`/`useQuery` ran again
    // — confirmed on CI. A local `wrapper` (RTL's own option) is what makes `rerender`
    // re-apply the providers on every call, matching `staff-form-dialog.test.tsx`'s and
    // `staff-import-dialog.test.tsx`'s own identical regression tests.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </NextIntlClientProvider>
      );
    }
    const { rerender } = render(<StudentCreateStepper open onOpenChange={onOpenChange} />, {
      wrapper: Wrapper,
    });

    await fillAndSubmitProfile();
    expect(await screen.findByText(/ayesha khan/i)).toBeInTheDocument();

    // The real close path: Profile stays mounted (just hidden) once past it, so
    // merely finding the field in the DOM proves nothing on its own — the actual
    // reset happens inside `handleClose`, which only runs from a real close
    // (the dialog's own Close button here), not from toggling the `open` prop by
    // itself (the mocked `onOpenChange` never would).
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    rerender(<StudentCreateStepper open={false} onOpenChange={onOpenChange} />);
    rerender(<StudentCreateStepper open onOpenChange={onOpenChange} />);

    const firstName = screen.getByLabelText(/first name/i);
    expect(firstName).toBeVisible();
    expect(firstName).toHaveValue("");
    expect(firstName).toBeEnabled();
  });
});
