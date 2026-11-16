import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

import { Paths } from "@/config/paths";
import {
  CAMPUS_KEYS,
  CLASS_KEYS,
  SECTION_KEYS,
  SESSION_KEYS,
  SUBJECT_KEYS,
} from "@/features/school/school-permissions";
import { hasAnyPermission } from "@/lib/permissions";
import type { OnboardingRecord, OnboardingStep, OnboardingStepKey } from "@/services";
import { FEE_STRUCTURE_CREATE_PERMISSION } from "@/services/modules/fee-structures/fee-structures-constant";
import {
  ONBOARDING_UPDATE_PERMISSION,
  SETUP_STEP_URL_KEY,
} from "@/services/modules/onboarding/onboarding-constant";
import { remainingSteps } from "@/services/modules/onboarding/onboarding-helper";
import { STAFF_INVITE_PERMISSION } from "@/services/modules/staff/staff-constant";
import {
  STUDENT_IMPORT_PERMISSION,
  STUDENT_IMPORT_URL_PARAM,
  STUDENT_IMPORT_URL_VALUE,
} from "@/services/modules/students/students-constant";

/** How a step is done: inside the wizard (an embedded School section), on another screen (a
 * link), or by activating a session (the go-live panel). */
export type SetupStepKind = "embedded" | "linked" | "goLive";

export interface SetupStepDefinition {
  kind: SetupStepKind;
  /** Whoever holds any of these can act on the step; nobody else is shown its action. */
  actionKeys: readonly PermissionKey[];
  /** A linked step's screen, and the label key of the link to it. */
  link?: { href: string; labelKey: "openFeeStructures" | "openStaff" | "openStudentImport" };
}

/** Every step, keyed by the server's step key (fh-constraints' "who sees what"). */
export const SETUP_STEPS: Record<OnboardingStepKey, SetupStepDefinition> = {
  profile: { kind: "embedded", actionKeys: [ONBOARDING_UPDATE_PERMISSION] },
  campuses: { kind: "embedded", actionKeys: [CAMPUS_KEYS.create] },
  academic_session: { kind: "embedded", actionKeys: [SESSION_KEYS.create] },
  classes: { kind: "embedded", actionKeys: [CLASS_KEYS.create, SECTION_KEYS.create] },
  subjects: { kind: "embedded", actionKeys: [SUBJECT_KEYS.create] },
  fee_structures: {
    kind: "linked",
    actionKeys: [FEE_STRUCTURE_CREATE_PERMISSION],
    link: { href: Paths.FEES_STRUCTURES, labelKey: "openFeeStructures" },
  },
  staff_invites: {
    kind: "linked",
    actionKeys: [STAFF_INVITE_PERMISSION],
    link: { href: Paths.STAFF, labelKey: "openStaff" },
  },
  students: {
    kind: "linked",
    actionKeys: [STUDENT_IMPORT_PERMISSION],
    link: {
      href: `${Paths.STUDENTS}?${STUDENT_IMPORT_URL_PARAM}=${STUDENT_IMPORT_URL_VALUE}`,
      labelKey: "openStudentImport",
    },
  },
  go_live: { kind: "goLive", actionKeys: [SESSION_KEYS.activate] },
};

export function canActOnStep(user: AuthenticatedUser | undefined, key: OnboardingStepKey): boolean {
  return hasAnyPermission(user, SETUP_STEPS[key].actionKeys);
}

/** The remaining steps this user can act on: the card and the wizard show only when there is one. */
export function actionableSteps(
  record: OnboardingRecord,
  user: AuthenticatedUser | undefined,
): OnboardingStep[] {
  return remainingSteps(record).filter((step) => canActOnStep(user, step.key));
}

/** The `/setup` link that opens on ``step``. */
export function setupStepHref(key: OnboardingStepKey): string {
  return `${Paths.SETUP}?${new URLSearchParams({ [SETUP_STEP_URL_KEY]: key }).toString()}`;
}
