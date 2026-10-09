"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import {
  Button,
  Stepper,
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
  // The highest step ever reached this wizard session — lets the step tabs and
  // Back/Next jump to any already-visited step, not just the immediately
  // adjacent one. Profile (1) is always reachable since it's the start.
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [created, setCreated] = useState<CreatedStudent | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  // Both Profile footer buttons are `type="submit"` targeting the same external
  // `form="student-create-profile-step"` (Profile's own footer lives outside its
  // `<form>`, submitted by id) — this records which one was actually clicked so
  // `onCreated` below knows whether to advance to Guardians or finish immediately.
  // A ref, not state: it's read once, synchronously, inside `onCreated`'s own
  // callback after the mutation resolves, not during a render.
  const profileFinishIntentRef = useRef(false);

  function goToStep(step: number) {
    setActiveStep(step);
    setMaxStepReached((max) => Math.max(max, step));
  }

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
    ...(canViewEnrollment ? [{ key: "enrollment" as const, label: t("stepper.enrollment") }] : []),
  ];
  const lastStepNumber = steps.length;
  const currentKey = steps[activeStep - 1]?.key;

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      // Fresh instance per open (`WithdrawStudentDialog`'s own convention): never
      // resume a half-finished wizard on reopen.
      setActiveStep(1);
      setMaxStepReached(1);
      setCreated(null);
      setIsPhotoUploading(false);
    }
    onOpenChange(nextOpen);
  }

  function goNext() {
    if (activeStep < lastStepNumber) goToStep(activeStep + 1);
    else handleClose(false);
  }
  function goBack() {
    if (activeStep > 1) goToStep(activeStep - 1);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleClose}>
      <ResponsiveDialogContent className="max-w-2xl" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("form.createTitle")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody
          className={
            isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
          }
        >
          {/* Each step's trigger is reachable up to `maxStepReached` — the highest
              step this wizard session has gotten to — so the tabs double as Back/
              Next's own shortcut, jumping straight to any already-visited step
              (`StepperItem`'s own `disabled` prop sets `StepperTrigger`'s
              `isDisabled` via context; `StepperTrigger` must NOT also receive a
              literal `disabled` prop itself — that prop lands in its own
              `...props` spread, which runs *after* the context-driven
              `disabled={isDisabled}` in its render and would silently force every
              trigger permanently disabled regardless of the real step index. One
              or the other, never both.) */}
          <Stepper value={activeStep} onValueChange={goToStep}>
            <StepperNav className="mb-4 gap-2">
              {steps.map((step, index) => {
                const stepNumber = index + 1;
                return (
                  <StepperItem
                    key={step.key}
                    step={stepNumber}
                    disabled={stepNumber > maxStepReached}
                  >
                    <StepperTrigger>
                      <StepperIndicator>
                        {stepNumber < activeStep ? (
                          <Check className="size-3.5" aria-hidden="true" />
                        ) : (
                          stepNumber
                        )}
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

          {/* Always mounted, never conditionally unmounted like the other steps
              below: hidden (not removed) once the user moves past it, so its
              entered values survive a trip back to it via Back or its own tab —
              `student-form-schema`'s own RHF state would otherwise reset to blank
              on every remount. `locked` takes over once `created` exists, so a
              revisit can never resubmit and create a second student. */}
          <div className={currentKey === "profile" ? undefined : "hidden"}>
            <StudentCreateProfileStep
              onCreated={(student) => {
                setCreated(student);
                // A viewer with only `students.student.create` has no step past
                // Profile either way — `lastStepNumber < 2` covers that case the
                // same as an explicit Finish click.
                if (profileFinishIntentRef.current || lastStepNumber < 2) {
                  profileFinishIntentRef.current = false;
                  handleClose(false);
                } else {
                  goToStep(2);
                }
              }}
              onUploadingChange={setIsPhotoUploading}
              locked={created !== null}
            />
          </div>
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
          {/* Back reaches every earlier step, Profile included — once the student
              exists, Profile re-renders locked (read-only), so going back to it
              never risks a second `createStudent` call. */}
          {activeStep > 1 && (
            <Button type="button" variant="outline" onClick={goBack}>
              {tCommon("previous")}
            </Button>
          )}
          {currentKey === "profile" && !created ? (
            <>
              {/* Same reasoning as the Finish button on every later step (below):
                  there's no reason to force a click through Guardians just to stop
                  — creating the student is already a complete, supported exit. */}
              {lastStepNumber >= 2 && (
                <Button
                  type="submit"
                  form="student-create-profile-step"
                  variant="outline"
                  disabled={isPhotoUploading}
                  onClick={() => {
                    profileFinishIntentRef.current = true;
                  }}
                >
                  {tCommon("finish")}
                </Button>
              )}
              <Button
                type="submit"
                form="student-create-profile-step"
                disabled={isPhotoUploading}
                loadingLabel={t("form.submitting")}
                onClick={() => {
                  profileFinishIntentRef.current = false;
                }}
              >
                {lastStepNumber >= 2 ? tCommon("next") : tCommon("finish")}
              </Button>
            </>
          ) : currentKey === "profile" ? (
            // Revisited after creation: Profile is locked, so this is a plain
            // step-forward click, never a resubmit.
            <Button type="button" onClick={goNext}>
              {activeStep >= lastStepNumber ? tCommon("finish") : tCommon("next")}
            </Button>
          ) : (
            <>
              {/* Once Profile has created the real student, every later step is
                  optional (Global Constraints) — a user who's done filling in
                  whatever they wanted shouldn't have to click Next through the
                  remaining steps just to close. Omitted on the last step, where
                  the Next button below already finishes directly. */}
              {activeStep < lastStepNumber && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handleClose(false);
                  }}
                >
                  {tCommon("finish")}
                </Button>
              )}
              <Button type="button" onClick={goNext}>
                {/* `>=`, not `===`: a viewer with only `students.student.create`
                    has no step past Profile, so `onCreated` advances `activeStep`
                    to 2 with `lastStepNumber` still 1 — this button is the only
                    one rendered then, and must read "Finish", not "Next". */}
                {activeStep >= lastStepNumber ? tCommon("finish") : tCommon("next")}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
