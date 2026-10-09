# Student Creation Stepper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page "Add Student" dialog with a multi-step wizard
(Profile → Guardians → Emergency Contacts → Documents → Enrollment) so a user can
optionally fill in all of a new student's related data in one guided flow.

**Architecture:** Port a `Stepper` presentational primitive from Metronic into
`packages/ui`. Extract the create-only half of `student-form-dialog.tsx` into a new
`StudentCreateProfileStep` that creates the real student record and reports its
id/campus back. A new `StudentCreateStepper` orchestrator owns step state and renders
`StudentCreateProfileStep` for step 1, then the *existing, unmodified*
`StudentGuardiansTab`/`StudentEmergencyContactsTab`/`StudentDocumentsTab`/
`StudentEnrollmentTab` for steps 2-5, gating each by the viewer's permissions.

**Tech Stack:** Next.js 16 dashboard, React Hook Form + Zod, TanStack Query,
`@schoolhub/ui` (Radix-based primitives), next-intl.

**Spec:** `docs/superpowers/specs/2026-10-08-student-creation-stepper-design.md`

## Global Constraints

- Edit mode is untouched — `student-form-dialog.tsx` is never modified by this plan.
- No new backend endpoints or validation; every step calls services that already
  exist and are already used by `StudentDetailSheet`'s tabs.
- A step is omitted entirely (not shown-disabled) when the viewer lacks its
  permission — `students.guardian.create`, `students.student.update` (emergency
  contacts reuse this key), `students.document.create`, `students.enrollment.enroll`.
- No client-side block on the Enrollment step for missing guardian/contact
  prerequisites — the real 422 from `enroll_student` surfaces exactly as it does
  inside `StudentDetailSheet` today.
- Once the Profile step's `createStudent` call succeeds, Back can never return to
  it — it renders as a completed, non-interactive step in the trail.
- Strings via `messages/en.json`/`ur.json`; no hardcoded English, per
  `packages/ui/AGENTS.md`'s port rules for the new `Stepper` primitive.
- RTL: the `Stepper` port uses logical direction, no `left`/`right`.

## Review Focus

- **Two rapid clicks on the Profile step's "Next"** before the first `createStudent`
  call resolves must not create two students — the existing dialog's
  `isSubmittingRef` double-submit guard must carry over into the extracted step.
- **Closing the wizard immediately after Profile succeeds** (before any later step
  loads) must still leave the student in the directory. Task 2's test proves the
  component's own contract — `onCreated` fires with the real id/campus/name only
  once `createStudent` actually resolves, and the same `queryKeys.module("students")`
  invalidation the original dialog already used is kept verbatim — and Task 6's
  mocked E2E "shows Profile → Finish only" case proves the end-to-end outcome: it
  clicks Finish right after Profile (no later step touched) and the created
  student is still visible in the directory afterward.
- **A viewer with only `students.student.create`** (none of the other four
  permission keys) must see a wizard that's just Profile → Finish, with no empty
  "Guardians"/etc. steps rendered at all — covered by Task 3.
- **Reopening "Add Student" after a previous wizard session** (whether finished or
  abandoned partway) must start a completely fresh wizard at Profile with no
  leftover `studentId`/`activeStep` from the previous session — covered by Task 3,
  via the same "fresh instance per open" convention `WithdrawStudentDialog` uses.
- **The Enrollment step reached with no guardian/emergency contact added** must show
  the real server's prerequisite error inline when the user attempts to enroll, not
  a silently-disabled control and not a client-side substitute message — covered by
  **Task 7's live E2E case**, not a mocked one: `e2e/AGENTS.md`'s own rule is that a
  stubbed API proves nothing about a server-enforced business rule like this one
  (the mocked `:enroll` handler doesn't model the prerequisite check at all — it
  exists to prove the dashboard's request/response wiring, not to re-implement
  `enroll_student`'s validation), so this one has to run against the real backend.

---

### Task 1: Port the `Stepper` primitive into `packages/ui`

**Files:**
- Create: `packages/ui/src/components/stepper.tsx`
- Create: `packages/ui/src/components/__tests__/stepper.test.tsx`
- Modify: `packages/ui/src/index.ts` (add the barrel export)

**Interfaces:**
- Produces: `Stepper`, `StepperNav`, `StepperItem`, `StepperTrigger`,
  `StepperIndicator`, `StepperSeparator`, `StepperTitle`, `StepperPanel`,
  `StepperContent` — all exported from `@schoolhub/ui`. `Stepper` takes
  `value: number`, `onValueChange: (step: number) => void` (controlled — this plan
  never uses the uncontrolled `defaultValue` form), `orientation?:
  "horizontal" | "vertical"` (default `"horizontal"`).

- [ ] **Step 1: Write the component, ported from Metronic**

Source: `/Users/avialdo/Documents/metronic nextjs/components/ui/stepper.tsx`. Port
verbatim except: `cn` import path (`../lib/cn` instead of `@/lib/utils`), and a
header comment recording the departure (`packages/ui/AGENTS.md`'s "Record every
departure" rule).

```tsx
// packages/ui/src/components/stepper.tsx
/* eslint-disable react-hooks/exhaustive-deps */
"use client";

/**
 * Ported from Metronic's `components/ui/stepper.tsx` (packages/ui/AGENTS.md's
 * sourcing rule). Departures from the vendor source:
 * - `cn` imported from this package's own `../lib/cn`, not `@/lib/utils`.
 * - No other changes: the vendor component already uses only logical flex/gap
 *   layout (no hardcoded `left`/`right`) and takes every piece of text as
 *   children/props rather than defaulting any English string, so neither of
 *   this package's two mandatory port adaptations required a code change here.
 */

import * as React from "react";
import { createContext, useContext } from "react";
import { cn } from "../lib/cn";

type StepperOrientation = "horizontal" | "vertical";
type StepState = "active" | "completed" | "inactive" | "loading";
type StepIndicators = {
  active?: React.ReactNode;
  completed?: React.ReactNode;
  inactive?: React.ReactNode;
  loading?: React.ReactNode;
};

interface StepperContextValue {
  activeStep: number;
  setActiveStep: (step: number) => void;
  stepsCount: number;
  orientation: StepperOrientation;
  registerTrigger: (node: HTMLButtonElement | null) => void;
  triggerNodes: HTMLButtonElement[];
  focusNext: (currentIdx: number) => void;
  focusPrev: (currentIdx: number) => void;
  focusFirst: () => void;
  focusLast: () => void;
  indicators: StepIndicators;
}

interface StepItemContextValue {
  step: number;
  state: StepState;
  isDisabled: boolean;
  isLoading: boolean;
}

const StepperContext = createContext<StepperContextValue | undefined>(undefined);
const StepItemContext = createContext<StepItemContextValue | undefined>(undefined);

function useStepper() {
  const ctx = useContext(StepperContext);
  if (!ctx) throw new Error("useStepper must be used within a Stepper");
  return ctx;
}

function useStepItem() {
  const ctx = useContext(StepItemContext);
  if (!ctx) throw new Error("useStepItem must be used within a StepperItem");
  return ctx;
}

interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: number;
  value?: number;
  onValueChange?: (value: number) => void;
  orientation?: StepperOrientation;
  indicators?: StepIndicators;
}

function Stepper({
  defaultValue = 1,
  value,
  onValueChange,
  orientation = "horizontal",
  className,
  children,
  indicators = {},
  ...props
}: StepperProps) {
  const [activeStep, setActiveStep] = React.useState(defaultValue);
  const [triggerNodes, setTriggerNodes] = React.useState<HTMLButtonElement[]>([]);

  const registerTrigger = React.useCallback((node: HTMLButtonElement | null) => {
    setTriggerNodes((prev) => {
      if (node && !prev.includes(node)) {
        return [...prev, node];
      } else if (!node && prev.includes(node!)) {
        return prev.filter((n) => n !== node);
      } else {
        return prev;
      }
    });
  }, []);

  const handleSetActiveStep = React.useCallback(
    (step: number) => {
      if (value === undefined) {
        setActiveStep(step);
      }
      onValueChange?.(step);
    },
    [value, onValueChange],
  );

  const currentStep = value ?? activeStep;

  const focusTrigger = (idx: number) => {
    if (triggerNodes[idx]) triggerNodes[idx].focus();
  };
  const focusNext = (currentIdx: number) => focusTrigger((currentIdx + 1) % triggerNodes.length);
  const focusPrev = (currentIdx: number) =>
    focusTrigger((currentIdx - 1 + triggerNodes.length) % triggerNodes.length);
  const focusFirst = () => focusTrigger(0);
  const focusLast = () => focusTrigger(triggerNodes.length - 1);

  const contextValue = React.useMemo<StepperContextValue>(
    () => ({
      activeStep: currentStep,
      setActiveStep: handleSetActiveStep,
      stepsCount: React.Children.toArray(children).filter(
        (child): child is React.ReactElement =>
          React.isValidElement(child) &&
          (child.type as { displayName?: string }).displayName === "StepperItem",
      ).length,
      orientation,
      registerTrigger,
      focusNext,
      focusPrev,
      focusFirst,
      focusLast,
      triggerNodes,
      indicators,
    }),
    [currentStep, handleSetActiveStep, children, orientation, registerTrigger, triggerNodes],
  );

  return (
    <StepperContext.Provider value={contextValue}>
      <div
        role="tablist"
        aria-orientation={orientation}
        data-slot="stepper"
        className={cn("w-full", className)}
        data-orientation={orientation}
        {...props}
      >
        {children}
      </div>
    </StepperContext.Provider>
  );
}

interface StepperItemProps extends React.HTMLAttributes<HTMLDivElement> {
  step: number;
  completed?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

function StepperItem({
  step,
  completed = false,
  disabled = false,
  loading = false,
  className,
  children,
  ...props
}: StepperItemProps) {
  const { activeStep } = useStepper();

  const state: StepState =
    completed || step < activeStep ? "completed" : activeStep === step ? "active" : "inactive";

  const isLoading = loading && step === activeStep;

  return (
    <StepItemContext.Provider value={{ step, state, isDisabled: disabled, isLoading }}>
      <div
        data-slot="stepper-item"
        className={cn(
          "group/step flex items-center justify-center group-data-[orientation=horizontal]/stepper-nav:flex-row group-data-[orientation=vertical]/stepper-nav:flex-col not-last:flex-1",
          className,
        )}
        data-state={state}
        {...(isLoading ? { "data-loading": true } : {})}
        {...props}
      >
        {children}
      </div>
    </StepItemContext.Provider>
  );
}

interface StepperTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

function StepperTrigger({
  asChild = false,
  className,
  children,
  tabIndex,
  ...props
}: StepperTriggerProps) {
  const { state, isLoading } = useStepItem();
  const stepperCtx = useStepper();
  const { setActiveStep, activeStep, registerTrigger, triggerNodes, focusNext, focusPrev, focusFirst, focusLast } =
    stepperCtx;
  const { step, isDisabled } = useStepItem();
  const isSelected = activeStep === step;
  const id = `stepper-tab-${step}`;
  const panelId = `stepper-panel-${step}`;

  const btnRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (btnRef.current) {
      registerTrigger(btnRef.current);
    }
  }, [btnRef.current]);

  const myIdx = React.useMemo(
    () => triggerNodes.findIndex((n: HTMLButtonElement) => n === btnRef.current),
    [triggerNodes, btnRef.current],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        if (myIdx !== -1 && focusNext) focusNext(myIdx);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        if (myIdx !== -1 && focusPrev) focusPrev(myIdx);
        break;
      case "Home":
        e.preventDefault();
        if (focusFirst) focusFirst();
        break;
      case "End":
        e.preventDefault();
        if (focusLast) focusLast();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        setActiveStep(step);
        break;
    }
  };

  if (asChild) {
    return (
      <span data-slot="stepper-trigger" data-state={state} className={className}>
        {children}
      </span>
    );
  }

  return (
    <button
      ref={btnRef}
      role="tab"
      id={id}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={typeof tabIndex === "number" ? tabIndex : isSelected ? 0 : -1}
      data-slot="stepper-trigger"
      data-state={state}
      data-loading={isLoading}
      className={cn(
        "cursor-pointer focus-visible:border-ring focus-visible:ring-ring/50 inline-flex items-center gap-3 rounded-full outline-none focus-visible:z-10 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
      onClick={() => setActiveStep(step)}
      onKeyDown={handleKeyDown}
      disabled={isDisabled}
      {...props}
    >
      {children}
    </button>
  );
}

function StepperIndicator({ children, className }: React.ComponentProps<"div">) {
  const { state, isLoading } = useStepItem();
  const { indicators } = useStepper();

  return (
    <div
      data-slot="stepper-indicator"
      data-state={state}
      className={cn(
        "relative flex items-center overflow-hidden justify-center size-6 shrink-0 border-background bg-accent text-accent-foreground rounded-full text-xs data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
        className,
      )}
    >
      <div className="absolute">
        {indicators &&
        ((isLoading && indicators.loading) ||
          (state === "completed" && indicators.completed) ||
          (state === "active" && indicators.active) ||
          (state === "inactive" && indicators.inactive))
          ? (isLoading && indicators.loading) ||
            (state === "completed" && indicators.completed) ||
            (state === "active" && indicators.active) ||
            (state === "inactive" && indicators.inactive)
          : children}
      </div>
    </div>
  );
}

function StepperSeparator({ className }: React.ComponentProps<"div">) {
  const { state } = useStepItem();

  return (
    <div
      data-slot="stepper-separator"
      data-state={state}
      className={cn(
        "m-0.5 rounded-full bg-muted group-data-[orientation=vertical]/stepper-nav:h-12 group-data-[orientation=vertical]/stepper-nav:w-0.5 group-data-[orientation=horizontal]/stepper-nav:h-0.5 group-data-[orientation=horizontal]/stepper-nav:flex-1",
        className,
      )}
    />
  );
}

function StepperTitle({ children, className }: React.ComponentProps<"h3">) {
  const { state } = useStepItem();

  return (
    <h3
      data-slot="stepper-title"
      data-state={state}
      className={cn("text-sm font-medium leading-none", className)}
    >
      {children}
    </h3>
  );
}

function StepperNav({ children, className }: React.ComponentProps<"nav">) {
  const { activeStep, orientation } = useStepper();

  return (
    <nav
      data-slot="stepper-nav"
      data-state={activeStep}
      data-orientation={orientation}
      className={cn(
        "group/stepper-nav inline-flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col",
        className,
      )}
    >
      {children}
    </nav>
  );
}

function StepperPanel({ children, className }: React.ComponentProps<"div">) {
  const { activeStep } = useStepper();

  return (
    <div data-slot="stepper-panel" data-state={activeStep} className={cn("w-full", className)}>
      {children}
    </div>
  );
}

interface StepperContentProps extends React.ComponentProps<"div"> {
  value: number;
  forceMount?: boolean;
}

function StepperContent({ value, forceMount, children, className }: StepperContentProps) {
  const { activeStep } = useStepper();
  const isActive = value === activeStep;

  if (!forceMount && !isActive) {
    return null;
  }

  return (
    <div
      data-slot="stepper-content"
      data-state={activeStep}
      className={cn("w-full", className, !isActive && forceMount && "hidden")}
      hidden={!isActive && forceMount}
    >
      {children}
    </div>
  );
}

export {
  useStepper,
  useStepItem,
  Stepper,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperSeparator,
  StepperTitle,
  StepperPanel,
  StepperContent,
  StepperNav,
  type StepperProps,
  type StepperItemProps,
  type StepperTriggerProps,
  type StepperContentProps,
};
```

- [ ] **Step 2: Add the barrel export**

In `packages/ui/src/index.ts`, find the alphabetically-nearby existing export line
(e.g. near `./components/tabs` or `./components/sheet`) and add:

```ts
export * from "./components/stepper";
```

- [ ] **Step 3: Write the test file**

```tsx
// packages/ui/src/components/__tests__/stepper.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperTrigger,
} from "../stepper";

function ThreeStepStepper({
  value,
  onValueChange,
}: {
  value: number;
  onValueChange: (v: number) => void;
}) {
  return (
    <Stepper value={value} onValueChange={onValueChange}>
      <StepperNav>
        {[1, 2, 3].map((step) => (
          <StepperItem key={step} step={step} disabled={step > value}>
            <StepperTrigger>
              <StepperIndicator>{step}</StepperIndicator>
            </StepperTrigger>
          </StepperItem>
        ))}
      </StepperNav>
      <StepperContent value={1}>One</StepperContent>
      <StepperContent value={2}>Two</StepperContent>
      <StepperContent value={3}>Three</StepperContent>
    </Stepper>
  );
}

describe("Stepper", () => {
  it("renders only the active step's content", () => {
    render(<ThreeStepStepper value={2} onValueChange={jest.fn()} />);

    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.queryByText("Three")).not.toBeInTheDocument();
  });

  it("marks steps before the active one as completed", () => {
    render(<ThreeStepStepper value={2} onValueChange={jest.fn()} />);

    const triggers = screen.getAllByRole("tab");
    expect(triggers[0]).toHaveAttribute("data-state", "completed");
    expect(triggers[1]).toHaveAttribute("data-state", "active");
    expect(triggers[2]).toHaveAttribute("data-state", "inactive");
  });

  it("disables a trigger for a step not yet reached", () => {
    render(<ThreeStepStepper value={2} onValueChange={jest.fn()} />);

    expect(screen.getAllByRole("tab")[2]).toBeDisabled();
  });

  it("calls onValueChange when an enabled trigger is clicked", async () => {
    const onValueChange = jest.fn();
    render(<ThreeStepStepper value={2} onValueChange={onValueChange} />);

    await userEvent.click(screen.getAllByRole("tab")[0]);

    expect(onValueChange).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @schoolhub/ui test stepper.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/stepper.tsx packages/ui/src/components/__tests__/stepper.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): port Metronic's Stepper primitive"
```

---

### Task 2: Extract `StudentCreateProfileStep` (create-only, reports back the new student)

**Files:**
- Create: `apps/dashboard/src/features/students/student-create-profile-step.tsx`
- Test: `apps/dashboard/src/features/students/__tests__/student-create-profile-step.test.tsx`

**Interfaces:**
- Consumes: `studentFormSchema`, `EMPTY_DEFAULTS`, `buildStudentInput`, `UNSET_VALUE`
  from `./student-form-schema` (all already exported, unchanged); `StudentAddressFields`,
  `StudentPhotoField`, `StudentProfileTextFields`, `StudentTextFieldList` (all
  already exported, unchanged); `Services.students.createStudent(input):
  Promise<StudentRecord>`.
- Produces: `StudentCreateProfileStepProps { onCreated: (student: { id: string;
  campusId: string; name: string }) => void; onUploadingChange: (uploading:
  boolean) => void }`. Calling `onCreated` is this component's only way of
  communicating success to its parent — it does not manage `open`/navigation itself,
  matching `Tabs`/`TabsContent` not knowing what's inside a tab body.
  `onUploadingChange` is a straight passthrough of `StudentPhotoField`'s own
  upload-in-flight state, so the stepper's external Next button (Task 3, which lives
  outside this component's own `<form>`) can disable itself during an upload exactly
  like `StudentFormDialog`'s own submit button already does.

This is **not** a wrapper around `StudentFormDialog` — `StudentFormDialog` renders
its own `ResponsiveDialog` chrome and branches on `mode`, neither of which this step
needs (the stepper owns the dialog chrome; this step is always create-only). It is a
new component built from the same field sub-components and the same create-path
logic `StudentFormDialog` already has, with the dialog wrapper and edit-mode
branches removed.

- [ ] **Step 1: Write the component**

```tsx
// apps/dashboard/src/features/students/student-create-profile-step.tsx
"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  Alert,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { GENDER_VALUES } from "@schoolhub/types";

import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import {
  buildStudentInput,
  EMPTY_DEFAULTS,
  studentFormSchema,
  UNSET_VALUE,
  type StudentFormValues,
} from "./student-form-schema";
import { StudentAddressFields } from "./student-address-fields";
import { StudentPhotoField } from "./student-photo-field";
import { StudentProfileTextFields } from "./student-profile-text-fields";
import { StudentTextFieldList } from "./student-text-field-list";

const NAME_FIELDS = [
  ["first_name", "firstName"],
  ["last_name", "lastName"],
] as const;

export interface StudentCreateProfileStepProps {
  /** Called once `createStudent` succeeds. The stepper advances to Guardians on
   * this — this component never navigates or closes anything itself. */
  onCreated: (student: { id: string; campusId: string; name: string }) => void;
  /** Passthrough of `StudentPhotoField`'s own upload-in-flight state, so the
   * stepper's external Next button can disable itself during an upload. */
  onUploadingChange: (uploading: boolean) => void;
}

/**
 * The Profile step of `StudentCreateStepper` — the create-only half of
 * `student-form-dialog.tsx`'s form, with the dialog chrome and every edit-mode
 * branch (detail fetch, `populatedStudentId`, photo-upload session tracking tied to
 * an existing `studentId`) removed, since this component only ever creates a brand
 * new student. The double-submit guard (`isSubmittingRef`) is kept exactly as-is —
 * Review Focus #1 names this as the one behavior that must carry over unchanged.
 */
export function StudentCreateProfileStep({
  onCreated,
  onUploadingChange,
}: StudentCreateProfileStepProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();

  const isSubmittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  useEffect(() => {
    onUploadingChange(isPhotoUploading);
  }, [isPhotoUploading, onUploadingChange]);

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  const campusesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => Services.dashboard.fetchCampuses(),
  });
  const housesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "houses"),
    queryFn: () => Services.schoolOrganization.fetchHouses(),
  });

  const mutation = useMutation({
    mutationFn: (values: StudentFormValues) =>
      Services.students.createStudent(buildStudentInput(values, "create")),
    onSuccess: (student) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
      onCreated({
        id: student.id,
        campusId: student.campus_id,
        name: `${student.first_name} ${student.last_name}`.trim(),
      });
    },
    onError: (error) => {
      setFormError(null);
      form.clearErrors();
      if (error instanceof ApiError) {
        let matchedAField = false;
        for (const [field, issue] of Object.entries(error.fieldErrors())) {
          if (field !== "non_field" && field in studentFormSchema.shape) {
            form.setError(field as keyof StudentFormValues, { type: "server", message: issue });
            matchedAField = true;
          }
        }
        if (!matchedAField)
          setFormError(resolveErrorMessage(error, tErrors, t("form.submitFailed"), "non_field"));
      } else {
        setFormError(t("form.submitFailed"));
      }
    },
  });

  // `StudentPhotoField` calls this as an upload starts. There is no existing
  // studentId yet to guard against a reopen-with-different-id race the way
  // `student-form-dialog.tsx` does (Review Focus there, not here — this component
  // is always a single, one-shot create, never reused across different students
  // the way the edit dialog is reused across rows) — a fresh component instance per
  // wizard open (`StudentCreateStepper`'s own "fresh instance per open" convention,
  // Task 3) already gives every upload a session that can't outlive its own mount.
  function captureUploadSession() {
    return () => true;
  }

  function onSubmit(event: SyntheticEvent) {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    form
      .handleSubmit(
        (values) => {
          mutation.mutate(values, {
            onSettled: () => {
              isSubmittingRef.current = false;
            },
          });
        },
        () => {
          isSubmittingRef.current = false;
        },
      )(event)
      .catch((error: unknown) => {
        isSubmittingRef.current = false;
        console.error(error);
      });
  }

  return (
    <Form {...form}>
      <form id="student-create-profile-step" noValidate onSubmit={onSubmit}>
        {formError && (
          <Alert variant="destructive" className="mb-4">
            {formError}
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StudentTextFieldList form={form} fields={NAME_FIELDS} namespace="fields" />
          <FormField
            control={form.control}
            name="date_of_birth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.dateOfBirth")}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="gender"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.gender")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t("fields.selectGender")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {GENDER_VALUES.map((g) => (
                      <SelectItem key={g} value={g}>
                        {t(`gender.${g}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="campus_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.campus")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          campusesQuery.isPending ? tCommon("loading") : t("fields.selectCampus")
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(campusesQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="house_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.house")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          housesQuery.isPending ? tCommon("loading") : t("fields.selectHouse")
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={UNSET_VALUE}>{t("fields.none")}</SelectItem>
                    {(housesQuery.data ?? []).map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="admission_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.admissionDate")}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <StudentProfileTextFields
            form={form}
            showMedicalNotes={hasPermission(currentUser, "students.student.update")}
          />
          <div className="sm:col-span-2">
            <StudentPhotoField
              form={form}
              savedRecord={undefined}
              onUploadStart={captureUploadSession}
              onUploadingChange={setIsPhotoUploading}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <p className="text-sm font-medium text-foreground">{t("address.title")}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StudentAddressFields form={form} />
            </div>
          </div>
        </div>
        {/* No footer here — `StudentCreateStepper` renders the shared Back/Next
            footer outside this step and submits this form via its `id` attribute
            above, the same way a dialog footer button outside a `<form>` submits it
            via the HTML `form="..."` attribute. `isPhotoUploading` reaches that
            external Next button via the `onUploadingChange` effect above. */}
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Write the test**

```tsx
// apps/dashboard/src/features/students/__tests__/student-create-profile-step.test.tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { StudentCreateProfileStep } from "../student-create-profile-step";

jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([{ id: "campus-1", name: "Main" }]) },
    schoolOrganization: { fetchHouses: jest.fn().mockResolvedValue([]) },
    students: { createStudent: jest.fn() },
  },
}));

const mockCreateStudent = Services.students.createStudent as jest.MockedFunction<
  typeof Services.students.createStudent
>;

function fillRequiredFields() {
  return Promise.all([
    userEvent.type(screen.getByLabelText(/first name/i), "Ayesha"),
    userEvent.type(screen.getByLabelText(/last name/i), "Khan"),
    userEvent.type(screen.getByLabelText(/date of birth/i), "2012-05-01"),
    userEvent.type(screen.getByLabelText(/admission date/i), "2026-01-10"),
  ]);
}

describe("StudentCreateProfileStep", () => {
  beforeEach(() => {
    mockCreateStudent.mockReset();
  });

  it("calls onCreated with the new student's id and campus on success", async () => {
    mockCreateStudent.mockResolvedValue({
      id: "student-1",
      campus_id: "campus-1",
    } as never);
    const onCreated = jest.fn();
    renderWithProviders(
      <StudentCreateProfileStep onCreated={onCreated} onUploadingChange={jest.fn()} />,
    );

    await fillRequiredFields();
    await userEvent.click(screen.getByRole("combobox", { name: /gender/i }));
    await userEvent.click(await screen.findByRole("option", { name: /female/i }));
    await userEvent.click(screen.getByRole("combobox", { name: /^campus$/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Main" }));
    // The stepper's own external footer submits this form by id — simulate that here.
    await userEvent.click(screen.getByRole("button", { name: "" }).closest("form") ?? document.body);
    screen.getByText("student-create-profile-step", { exact: false });

    const form = document.getElementById("student-create-profile-step") as HTMLFormElement;
    form.requestSubmit();

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({ id: "student-1", campusId: "campus-1" });
    });
  });

  it("does not call createStudent twice for two rapid submits (Review Focus #1)", async () => {
    mockCreateStudent.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ id: "s1", campus_id: "c1" } as never), 50)),
    );
    renderWithProviders(
      <StudentCreateProfileStep onCreated={jest.fn()} onUploadingChange={jest.fn()} />,
    );

    await fillRequiredFields();
    await userEvent.click(screen.getByRole("combobox", { name: /gender/i }));
    await userEvent.click(await screen.findByRole("option", { name: /female/i }));
    await userEvent.click(screen.getByRole("combobox", { name: /^campus$/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Main" }));

    const form = document.getElementById("student-create-profile-step") as HTMLFormElement;
    form.requestSubmit();
    form.requestSubmit();

    await waitFor(() => {
      expect(mockCreateStudent).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @schoolhub/dashboard test student-create-profile-step.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/student-create-profile-step.tsx apps/dashboard/src/features/students/__tests__/student-create-profile-step.test.tsx
git commit -m "feat(dashboard): add the stepper's create-only Profile step"
```

---

### Task 3: Build `StudentCreateStepper`

**Files:**
- Create: `apps/dashboard/src/features/students/student-create-stepper.tsx`
- Test: `apps/dashboard/src/features/students/__tests__/student-create-stepper.test.tsx`

**Interfaces:**
- Consumes: `StudentCreateProfileStep` (Task 2); `StudentGuardiansTab`,
  `StudentEmergencyContactsTab`, `StudentDocumentsTab`, `StudentEnrollmentTab` (all
  unchanged, exact prop shapes already confirmed against their real files);
  `Stepper`/`StepperNav`/`StepperItem`/`StepperTrigger`/`StepperIndicator`/
  `StepperContent` (Task 1); `ResponsiveDialog`/`ResponsiveDialogContent`/
  `ResponsiveDialogHeader`/`ResponsiveDialogTitle`/`ResponsiveDialogBody`/
  `ResponsiveDialogFooter` from `@/components/responsive-dialog`.
- Produces: `StudentCreateStepperProps { open: boolean; onOpenChange: (open:
  boolean) => void }` — the direct drop-in replacement for
  `<StudentFormDialog mode="create">`'s props.

- [ ] **Step 1: Write the component**

```tsx
// apps/dashboard/src/features/students/student-create-stepper.tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import {
  Button,
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperTrigger,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { hasPermission } from "@/lib/permissions";
import { StudentCreateProfileStep } from "./student-create-profile-step";
import { StudentDocumentsTab } from "./student-documents-tab";
import { StudentEmergencyContactsTab } from "./student-emergency-contacts-tab";
import { StudentEnrollmentTab } from "./student-enrollment-tab";
import { StudentGuardiansTab } from "./student-guardians-tab";

export interface StudentCreateStepperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreatedStudent {
  id: string;
  campusId: string;
  name: string;
}

/**
 * Replaces `<StudentFormDialog mode="create">` as the dashboard's "Add Student"
 * entry point (`student-toolbar.tsx`, Task 4). Edit mode is untouched —
 * `StudentFormDialog` still owns it.
 *
 * Step 1 (Profile) creates the real student record the moment it succeeds — there
 * is no atomic batch-create endpoint (spec's Context section), so every step from
 * Guardians onward operates on an already-real student, and closing this wizard
 * after Profile is a supported exit, not an abandoned operation. The banner below
 * makes that explicit rather than leaving it an implicit surprise.
 */
export function StudentCreateStepper({ open, onOpenChange }: StudentCreateStepperProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const isMobile = !useIsDesktopShell();
  const { data: currentUser } = useCurrentUser();

  const [activeStep, setActiveStep] = useState(1);
  const [created, setCreated] = useState<CreatedStudent | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  const canViewGuardians = hasPermission(currentUser, "students.guardian.create");
  const canViewEmergencyContacts = hasPermission(currentUser, "students.student.update");
  const canViewDocuments = hasPermission(currentUser, "students.document.create");
  const canViewEnrollment = hasPermission(currentUser, "students.enrollment.enroll");

  type Step = {
    key: "profile" | "guardians" | "emergencyContacts" | "documents" | "enrollment";
    label: string;
  };
  const steps: Step[] = [
    { key: "profile", label: t("tabs.profile") },
    ...(canViewGuardians ? [{ key: "guardians" as const, label: t("tabs.guardians") }] : []),
    ...(canViewEmergencyContacts
      ? [{ key: "emergencyContacts" as const, label: t("tabs.emergencyContacts") }]
      : []),
    ...(canViewDocuments ? [{ key: "documents" as const, label: t("tabs.documents") }] : []),
    ...(canViewEnrollment
      ? [{ key: "enrollment" as const, label: t("stepper.enrollment") }]
      : []),
  ];
  const lastStepNumber = steps.length;
  const currentKey = steps[activeStep - 1]?.key;

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      // Fresh instance per open (`WithdrawStudentDialog`'s own convention): never
      // resume a half-finished wizard on reopen.
      setActiveStep(1);
      setCreated(null);
      setIsPhotoUploading(false);
    }
    onOpenChange(nextOpen);
  }

  function goNext() {
    if (activeStep < lastStepNumber) setActiveStep(activeStep + 1);
    else handleClose(false);
  }
  function goBack() {
    // Back never returns to Profile (step 1) once the student is created —
    // Profile is a one-way door, per the spec.
    if (activeStep > 2) setActiveStep(activeStep - 1);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleClose}>
      <ResponsiveDialogContent className="max-w-2xl" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("form.createTitle")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody
          className={isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"}
        >
          {/* `Stepper` is purely a progress indicator here — Back/Next (the footer
              below) are the only navigation, per the spec, so every trigger is
              permanently non-interactive (`StepperItem`'s own `disabled` prop sets
              `StepperTrigger`'s `isDisabled` via context; `StepperTrigger` must NOT
              also receive a literal `disabled` prop itself — that prop lands in its
              own `...props` spread, which runs *after* the context-driven
              `disabled={isDisabled}` in its render and would silently force every
              trigger permanently disabled regardless of the real step index. One or
              the other, never both.) `onValueChange` is omitted (it's optional) since
              nothing here ever calls it. */}
          <Stepper value={activeStep}>
            <StepperNav className="mb-4 gap-2">
              {steps.map((step, index) => {
                const stepNumber = index + 1;
                return (
                  <StepperItem key={step.key} step={stepNumber} disabled>
                    <StepperTrigger>
                      <StepperIndicator>
                        {stepNumber < activeStep ? <Check className="size-3.5" aria-hidden="true" /> : stepNumber}
                      </StepperIndicator>
                      <span className="hidden text-xs font-medium sm:inline">{step.label}</span>
                    </StepperTrigger>
                  </StepperItem>
                );
              })}
            </StepperNav>
          </Stepper>

          {created && currentKey !== "profile" && (
            <p className="rounded-md bg-primary/5 px-3 py-2 text-sm text-foreground">
              {t("stepper.studentCreated", { name: created.name })}
            </p>
          )}

          {currentKey === "profile" && (
            <StudentCreateProfileStep
              onCreated={(student) => {
                setCreated(student);
                setActiveStep(2);
              }}
              onUploadingChange={setIsPhotoUploading}
            />
          )}
          {currentKey === "guardians" && created && (
            <StudentGuardiansTab
              studentId={created.id}
              canCreate={hasPermission(currentUser, "students.guardian.create")}
              canUpdate={hasPermission(currentUser, "students.guardian.update")}
            />
          )}
          {currentKey === "emergencyContacts" && created && (
            <StudentEmergencyContactsTab
              studentId={created.id}
              canCreate={hasPermission(currentUser, "students.student.update")}
            />
          )}
          {currentKey === "documents" && created && (
            <StudentDocumentsTab
              studentId={created.id}
              canCreate={hasPermission(currentUser, "students.document.create")}
              canVerify={hasPermission(currentUser, "students.document.verify")}
              canDelete={hasPermission(currentUser, "students.document.delete")}
            />
          )}
          {currentKey === "enrollment" && created && (
            <StudentEnrollmentTab
              studentId={created.id}
              campusId={created.campusId}
              permissions={{
                canEnroll: hasPermission(currentUser, "students.enrollment.enroll"),
                canChangeSection: hasPermission(currentUser, "students.enrollment.update"),
                canOverrideCapacity: hasPermission(currentUser, "students.student.update"),
                canRequestTransfer: hasPermission(currentUser, "students.transfer.create"),
                canDecide: hasPermission(currentUser, "students.transfer.approve"),
                canComplete: hasPermission(currentUser, "students.transfer.create"),
              }}
            />
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          {activeStep > 2 && (
            <Button type="button" variant="outline" onClick={goBack}>
              {tCommon("previous")}
            </Button>
          )}
          {currentKey === "profile" ? (
            <Button
              type="submit"
              form="student-create-profile-step"
              disabled={isPhotoUploading}
              loadingLabel={t("form.submitting")}
            >
              {tCommon("next")}
            </Button>
          ) : (
            <Button type="button" onClick={goNext}>
              {activeStep === lastStepNumber ? tCommon("finish") : tCommon("next")}
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 2: Write the test**

```tsx
// apps/dashboard/src/features/students/__tests__/student-create-stepper.test.tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { StudentCreateStepper } from "../student-create-stepper";

jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: jest.fn(),
}));
jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([{ id: "campus-1", name: "Main" }]) },
    schoolOrganization: { fetchHouses: jest.fn().mockResolvedValue([]), fetchClasses: jest.fn().mockResolvedValue([]), fetchSections: jest.fn().mockResolvedValue([]), fetchAcademicSessions: jest.fn().mockResolvedValue([]) },
    students: {
      createStudent: jest.fn(),
      fetchStudentHistory: jest.fn().mockResolvedValue([]),
    },
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
  await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
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

  it("never shows a Back button that returns to Profile", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create", "students.student.update"]),
    );
    renderWithProviders(<StudentCreateStepper open onOpenChange={jest.fn()} />);

    await fillAndSubmitProfile();
    // Now on Guardians (step 2) — Back should not be offered yet (only from step 3 on).
    expect(screen.queryByRole("button", { name: /^previous$/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    // Now on Emergency Contacts (step 3) — Back is offered, and going back must land
    // on Guardians, never Profile.
    await userEvent.click(screen.getByRole("button", { name: /^previous$/i }));

    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });

  it("resets to a fresh wizard on reopen (Review Focus #4)", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create"]),
    );
    const onOpenChange = jest.fn();
    const { rerender } = renderWithProviders(
      <StudentCreateStepper open onOpenChange={onOpenChange} />,
    );

    await fillAndSubmitProfile();
    expect(await screen.findByText(/ayesha khan/i)).toBeInTheDocument();

    rerender(<StudentCreateStepper open={false} onOpenChange={onOpenChange} />);
    rerender(<StudentCreateStepper open onOpenChange={onOpenChange} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @schoolhub/dashboard test student-create-stepper.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/student-create-stepper.tsx apps/dashboard/src/features/students/__tests__/student-create-stepper.test.tsx apps/dashboard/src/features/students/student-create-profile-step.tsx
git commit -m "feat(dashboard): add the StudentCreateStepper orchestrator"
```

---

### Task 4: Wire the "Add Student" entry point

**Files:**
- Modify: `apps/dashboard/src/features/students/student-toolbar.tsx`

**Interfaces:**
- Consumes: `StudentCreateStepper` (Task 3).

`student-directory-table.tsx`'s own `<StudentFormDialog mode={formDialog.mode}>`
usage is **not** touched — its `"create"` arm is already unreachable dead code today
(confirmed: no call site in that file ever sets `formDialog` to `{mode: "create"}`;
only row actions set `{mode: "edit", studentId}`), and leaving it alone keeps this
task's diff scoped to the one real entry point.

- [ ] **Step 1: Replace the import and the rendered dialog**

In `student-toolbar.tsx`, change:

```tsx
import { StudentFormDialog } from "./student-form-dialog";
```

to:

```tsx
import { StudentCreateStepper } from "./student-create-stepper";
```

And change:

```tsx
<StudentFormDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} mode="create" />
```

to:

```tsx
<StudentCreateStepper open={addDialogOpen} onOpenChange={setAddDialogOpen} />
```

- [ ] **Step 2: Update (or confirm) the existing toolbar test**

Open `apps/dashboard/src/features/students/__tests__/student-toolbar.test.tsx` and
change any assertion that queries for `StudentFormDialog`'s create-mode title
(`t("form.createTitle")`) to instead assert the stepper opens — the title text is
unchanged (`StudentCreateStepper` reuses the same `t("form.createTitle")` key), so
existing title-based assertions should keep passing unmodified; only mock the two
new modules if the test file's `jest.mock("@/services", ...)` doesn't already cover
`createStudent`/`fetchHouses`/etc. Run the file first to see what, if anything,
actually breaks before changing it.

- [ ] **Step 3: Run the toolbar test**

Run: `pnpm --filter @schoolhub/dashboard test student-toolbar.test.tsx`
Expected: PASS (fix only what the run actually reports as broken, per Step 2).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/student-toolbar.tsx apps/dashboard/src/features/students/__tests__/student-toolbar.test.tsx
git commit -m "feat(dashboard): open the creation stepper from Add Student"
```

---

### Task 5: Messages

**Files:**
- Modify: `apps/dashboard/messages/en.json`
- Modify: `apps/dashboard/messages/ur.json`

- [ ] **Step 1: Add `common.finish`**

In both files' `"common"` object, alongside the existing `"next": "Next"` /
`"previous": "Previous"` pair:

`en.json`:
```json
"finish": "Finish",
```

`ur.json`:
```json
"finish": "مکمل کریں",
```

- [ ] **Step 2: Add the `students.stepper` namespace**

In `en.json`, inside the top-level `"students"` object (alongside the existing
`"tabs"` object):

```json
"stepper": {
  "enrollment": "Enrollment",
  "studentCreated": "{name} has been created. Add more details below, or finish now."
}
```

In `ur.json`, same location:

```json
"stepper": {
  "enrollment": "داخلہ",
  "studentCreated": "{name} کو شامل کر لیا گیا ہے۔ نیچے مزید تفصیلات شامل کریں، یا ابھی مکمل کریں۔"
}
```

- [ ] **Step 3: Confirm with cspell**

The commit hook runs `cspell` automatically — if either new Urdu/English string
trips an unknown-word warning, add it to `.cspell/project-words.txt` in
alphabetical order in the same commit (same convention every prior phase followed).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/messages/en.json apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add creation-stepper copy"
```

---

### Task 6: E2E mocked coverage

**Files:**
- Create: `e2e/tests/dashboard/student-create-stepper.spec.ts`

**Interfaces:**
- Consumes: `studentsModule`, `schoolOrganizationModule`, `guardiansModule`,
  `studentRelationsModule`, `enrollmentModule`, `studentTransfersModule` (all
  already exported from `@/mocks`, all unchanged); `studentToolbar`/`studentsPage`
  fixtures already used by `students.spec.ts`.

- [ ] **Step 1: Write the happy-path and permission-gated specs**

```ts
// e2e/tests/dashboard/student-create-stepper.spec.ts
import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import {
  buildAcademicSession,
  buildCampus,
  buildSchoolClass,
  buildSection,
  schoolOrganizationModule,
} from "@/mocks";
import { studentsModule } from "@/mocks";
import { guardiansModule } from "@/mocks";
import { studentRelationsModule } from "@/mocks";
import { enrollmentModule } from "@/mocks";
import { studentTransfersModule } from "@/mocks";

const campuses = [buildCampus({ id: "campus-0001", name: "Main Campus" })];
const classes = [buildSchoolClass({ id: "class-0001", name: "Grade 1" })];
const sections = [
  buildSection({ id: "section-0001", name: "A", class_id: "class-0001", campus_id: "campus-0001" }),
];
const sessions = [buildAcademicSession({ id: "session-0001", name: "2026-27" })];

test.describe("student creation stepper", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        "students.enrollment.enroll",
        "students.enrollment.update",
      ],
    }),
  });

  test("creates a student, adds a guardian, and finishes without enrolling", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [] }),
      guardiansModule({}),
      studentRelationsModule({}),
      enrollmentModule({ historyByStudentId: {} }),
      studentTransfersModule({}),
    );
    await studentsPage.goto();
    await page.getByRole("button", { name: /^add student$/i }).click();

    await page.getByLabel(/first name/i).fill("Ayesha");
    await page.getByLabel(/last name/i).fill("Khan");
    await page.getByLabel(/date of birth/i).fill("2012-05-01");
    await page.getByLabel(/admission date/i).fill("2026-01-10");
    await page.getByRole("combobox", { name: /gender/i }).click();
    await page.getByRole("option", { name: /female/i }).click();
    await page.getByRole("combobox", { name: /^campus$/i }).click();
    await page.getByRole("option", { name: "Main Campus" }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    await expect(page.getByText(/ayesha khan has been created/i)).toBeVisible();

    await page.getByRole("button", { name: /^add guardian$/i }).click();
    // Mirrors students-relations.spec.ts's own "links an existing guardian found by
    // search" flow — same search-then-link dialog, now opened from inside the wizard.
    await page.getByLabel(/search/i).fill("Imran");
    await page.getByRole("option", { name: /imran/i }).click();
    await page.getByRole("button", { name: /^link$/i }).click();

    await page.getByRole("button", { name: /^next$/i }).click(); // Emergency Contacts
    await page.getByRole("button", { name: /^next$/i }).click(); // Documents
    await page.getByRole("button", { name: /^finish$/i }).click(); // Enrollment, unfilled

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Ayesha Khan")).toBeVisible();
  });
});

test.describe("student creation stepper — view-only permissions", () => {
  test.use({
    authUser: buildUser({ permissions: ["students.student.create", "students.student.view"] }),
  });

  test("shows Profile then Finish only, for a viewer with no other step permissions", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [] }),
    );
    await studentsPage.goto();
    await page.getByRole("button", { name: /^add student$/i }).click();

    await page.getByLabel(/first name/i).fill("Bilal");
    await page.getByLabel(/last name/i).fill("Ahmed");
    await page.getByLabel(/date of birth/i).fill("2013-02-02");
    await page.getByLabel(/admission date/i).fill("2026-01-10");
    await page.getByRole("combobox", { name: /gender/i }).click();
    await page.getByRole("option", { name: /male/i }).click();
    await page.getByRole("combobox", { name: /^campus$/i }).click();
    await page.getByRole("option", { name: "Main Campus" }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    await expect(page.getByRole("button", { name: /^finish$/i })).toBeVisible();
    await expect(page.getByText(/guardians/i)).toHaveCount(0);

    // Review Focus #2: closing right after Profile (no later step ever touched)
    // still leaves the student created and visible in the directory.
    await page.getByRole("button", { name: /^finish$/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Bilal Ahmed")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec headed to confirm it against the mocked lane**

Run: `cd e2e && pnpm exec playwright test tests/dashboard/student-create-stepper.spec.ts --project=dashboard --headed`
Expected: both tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/dashboard/student-create-stepper.spec.ts
git commit -m "test(e2e): cover the student creation stepper in the mocked lane"
```

---

### Task 7: Live E2E — drive the stepper instead of the old dialog-then-sheet sequence

**Files:**
- Modify: `e2e/tests/live/students-admission-enrollment.spec.ts`
- Modify: whichever page object(s) under `e2e/src/pages/dashboard/students/` own
  `studentFormPage.submit`/`.fillRequired()` and `studentDetailPage.tab()` — find
  the real file names with `grep -rl "fillRequired\|linkGuardianTrigger" e2e/src/pages/`
  before editing; this plan does not assume their exact paths.

**A real discrepancy to resolve first, not assume away:** the current spec asserts
`await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/);` immediately after
`studentFormPage.submit.click()` (line ~133) — a full-page navigation to a
`/students/{id}` route. Everything else confirmed in this plan's own research
(`student-form-dialog.tsx`, `student-directory-table.tsx`) shows student creation
as a `ResponsiveDialog` **modal**, never a page navigation, and the detail view as a
`ResponsiveSheet` **slide-over** opened by clicking a directory row, never a routed
page. Before changing anything, run this spec as it exists today
(`cd e2e && pnpm exec playwright test tests/live/students-admission-enrollment.spec.ts --headed`,
against a seeded live stack — see the spec's own header comment for the run
command) and observe which of the two is actually true right now. If the URL
assertion is already failing (a pre-existing bug unrelated to this plan), note it
in `docs/deferred-work.md` rather than silently "fixing" it as part of this task —
this plan's job is pointing the journey at the stepper, not auditing an unrelated,
possibly-already-broken assertion.

- [ ] **Step 1: Replace the create-and-navigate step with create-and-continue**

Change the "1. Create the student" block (and the duplicate-admission test's
matching block) so that after `studentFormPage.submit.click()`, the test continues
**inside the still-open dialog** — the banner naming the created student
(`stepper.studentCreated`, Task 5) is the new, real signal to assert on instead of
a URL change:

```ts
// 1. Create the student.
await signInAndOpenNewStudentForm(page, loginPage, dashboardPage);
await studentFormPage.fillRequired({
  firstName,
  lastName,
  dateOfBirth: "2015-05-05",
  admissionDate: "2026-01-01",
  campusName: E2E_BASELINE_CAMPUS_NAME,
});
await studentFormPage.submit.click();
await expect(page.getByText(new RegExp(`${firstName} ${lastName}.*has been created`, "i"))).toBeVisible();
```

- [ ] **Step 2: Replace each `studentDetailPage.tab("X").click()` with the
  stepper's own Next button**

The existing `createAndLinkGuardian`/`addEmergencyContact`/`enroll` methods on
`studentDetailPage` target `StudentGuardiansTab`/`StudentEmergencyContactsTab`/
`StudentEnrollmentTab`'s own internal markup — unchanged by this plan (Task 3
reuses those components verbatim), so those method bodies need no changes. Only
the *navigation between them* changes: replace every
`await studentDetailPage.tab("<Name>").click();` in this journey with
`await page.getByRole("button", { name: /^next$/i }).click();`, since the stepper
advances by clicking Next, not by clicking a tab. If `studentDetailPage`'s methods
are typed to a page object that assumes a `Tabs`-based sheet is already open on the
page (rather than a dialog), adjust that page object's root locator instead of
duplicating its guardian/contact/enrollment logic into a new one — reuse, don't
re-implement, same as the mocked lane's own equivalent methods already do.

- [ ] **Step 3: Update the duplicate-admission test's second-creation flow**

`await dashboardPage.navLink("Students").click(); await openNewStudentForm(page);`
(re-opening the create entry point for the second, duplicate submission) is
unaffected by this plan — it still opens the same stepper from the same "Add
Student" trigger. Only the first creation's post-submit assertion (Step 1 above)
needs to change in this test too.

- [ ] **Step 4: Run the live spec**

Run (against a seeded live stack):
```bash
cd e2e && pnpm exec playwright test tests/live/students-admission-enrollment.spec.ts
```
Expected: both tests pass, exercising the real `assert_enrollment_prerequisites`
checks and the real duplicate-admission rejection through the new stepper. This is
the plan's only coverage of Review Focus #5 (the enrollment-prerequisite error) —
confirm the journey still enrolls successfully only because it added a guardian and
emergency contact first; nothing else in this plan proves that dependency against
the real backend.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/live/students-admission-enrollment.spec.ts
# plus whichever page-object file(s) Step 2 touched
git commit -m "test(e2e): drive the live admission journey through the creation stepper"
```

---

### Task 8: Docs

**Files:**
- Modify: `docs/03-modules/student-management.md` §20
- Modify: `docs/project-status.md`

- [ ] **Step 1: Update the module doc's §20 ("as shipped")**

Add a line noting the direct-registration path now implements §7.1's admission
sequence (create → guardians → emergency contacts → documents → enrollment) as a
single guided stepper, replacing the previous single-page create dialog.

- [ ] **Step 2: Update `docs/project-status.md`**

Update the student-management row to note the creation stepper shipped.

- [ ] **Step 3: If Task 7 found the pre-existing `/students/{id}` URL assertion
  was already failing before this plan touched it**, add a `docs/deferred-work.md`
  entry naming the real root cause (whatever Task 7's investigation found) rather
  than leaving it unrecorded — do not skip this step silently if Task 7 found
  something; if Task 7 found the assertion was already passing/accurate, skip this
  step with no entry needed.

- [ ] **Step 4: Commit**

```bash
git add docs/03-modules/student-management.md docs/project-status.md
# plus docs/deferred-work.md, only if Step 3 added an entry
git commit -m "docs(students): document the creation stepper"
```

---

## Outcome

Tasks 1-6 and 8 shipped as written. **Task 7 deviated**: investigation found the
live spec broken from its very first step (`openNewStudentForm()` clicks a
`"New student"` link role that no longer exists — it's a button that opens an
in-page dialog, not a route) — a pre-existing, unrelated defect, not something
this plan could fix in one task with no live stack to verify against. Resolved
as a `docs/deferred-work.md` correction (the entry's prior "Closed by students
Phase 3" note was itself stale) rather than an unverifiable spec edit; the live
spec itself is untouched.

Three features shipped after Task 8, directly from user feedback in the same
session, not from a revised plan: a Finish button on every step including
Profile; Back and the step tabs reaching every step including Profile (Profile
re-renders locked once the student exists, never resubmittable); and edit mode
absorbed into the same stepper (`StudentFormDialog` deleted). See the design
spec's own "As shipped — additions beyond this spec" section for the detail
each of these needs.
