"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperTitle,
  StepperTrigger,
} from "@schoolhub/ui";

import { BROADCAST_MESSAGE_MAX_LENGTH } from "@/services/modules/broadcasts/broadcasts-constant";

import { AudienceStep } from "./audience-step";
import { BroadcastJobPanel } from "./broadcast-job-panel";
import {
  BROADCAST_DEFAULTS,
  buildBroadcastRequest,
  createBroadcastSchema,
  isBroadcastField,
  type BroadcastFormValues,
} from "./broadcast-form-schema";
import { ConfirmStep } from "./confirm-step";
import { MessageStep } from "./message-step";
import { useBroadcastCampuses } from "./use-broadcast-campuses";
import { useBroadcastKey } from "./use-broadcast-key";

const STEPS = ["audience", "message", "confirm", "status"] as const;
const [AUDIENCE, MESSAGE, CONFIRM, STATUS] = [1, 2, 3, 4];

type StepErrors = Partial<Record<keyof BroadcastFormValues, string>>;

/**
 * The Emergency broadcast wizard: audience, message, a previewed confirmation and the job's
 * status. A step's Next validates only its own fields; the confirm step previews the exact
 * request the earlier steps built. A campus-restricted sender must pick one of their own
 * campuses (preselected when there is only one); a sender who reaches none cannot go on.
 */
export function BroadcastScreen() {
  const t = useTranslations("communication.broadcast");
  const [picked, setPicked] = useState<BroadcastFormValues>(BROADCAST_DEFAULTS);
  const [step, setStep] = useState(AUDIENCE);
  const [errors, setErrors] = useState<StepErrors>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // Held here, not in ConfirmStep, so Back then Next after a lost send keeps the same key.
  const broadcastKey = useBroadcastKey();
  const { forget } = broadcastKey;
  const handleSendingChange = useCallback((sending: boolean) => {
    setIsSending(sending);
  }, []);

  const campuses = useBroadcastCampuses();
  const { requireCampus } = campuses;
  const canLeaveAudience = campuses.status === "ready" && !campuses.reachesNoCampus;
  // A restricted sender's pick counts only while their scope still allows it (a role change
  // refetches the scope), and one with a single campus has it picked for them.
  const isAllowed = campuses.options.some((campus) => campus.id === picked.campus_id);
  const keptCampus = requireCampus && !isAllowed ? "" : picked.campus_id;
  const onlyCampus =
    requireCampus && campuses.options.length === 1 ? campuses.options[0] : undefined;
  const campusId = keptCampus === "" && onlyCampus ? onlyCampus.id : keptCampus;
  const values = campusId === picked.campus_id ? picked : { ...picked, campus_id: campusId };

  const schema = useMemo(
    () =>
      createBroadcastSchema(
        {
          campusRequired: t("errors.campusRequired"),
          classRequired: t("errors.classRequired"),
          sectionRequired: t("errors.sectionRequired"),
          messageRequired: t("errors.messageRequired"),
          messageTooLong: t("errors.messageTooLong", { max: BROADCAST_MESSAGE_MAX_LENGTH }),
        },
        { requireCampus },
      ),
    [t, requireCampus],
  );

  function update(patch: Partial<BroadcastFormValues>) {
    setPicked((current) => ({ ...current, ...patch }));
    setErrors({});
  }

  /** Moves on from `from` when its own fields pass the schema. */
  function next(from: number, fields: (keyof BroadcastFormValues)[]) {
    const result = schema.safeParse(values);
    const found: StepErrors = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (isBroadcastField(field) && fields.includes(field)) found[field] ??= issue.message;
      }
    }
    setErrors(found);
    if (Object.keys(found).length === 0) setStep(from + 1);
  }

  function restart() {
    setPicked(BROADCAST_DEFAULTS);
    setErrors({});
    setJobId(null);
    forget();
    setStep(AUDIENCE);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <Stepper value={step} orientation="horizontal">
        <StepperNav>
          {STEPS.map((key, index) => (
            <StepperItem key={key} step={index + 1} disabled>
              <StepperTrigger>
                <StepperIndicator>{index + 1}</StepperIndicator>
                <StepperTitle>{t(`steps.${key}`)}</StepperTitle>
              </StepperTrigger>
            </StepperItem>
          ))}
        </StepperNav>
      </Stepper>

      {step === AUDIENCE && (
        <AudienceStep
          values={values}
          onChange={update}
          campuses={campuses}
          errors={{
            campus_id: errors.campus_id,
            class_ids: errors.class_ids,
            section_ids: errors.section_ids,
          }}
        />
      )}
      {step === MESSAGE && (
        <MessageStep
          message={values.message}
          onChange={(message) => {
            update({ message });
          }}
          error={errors.message}
        />
      )}
      {step === CONFIRM && (
        <ConfirmStep
          request={buildBroadcastRequest(values)}
          broadcastKey={broadcastKey}
          onSendingChange={handleSendingChange}
          onQueued={(id) => {
            setJobId(id);
            setStep(STATUS);
          }}
        />
      )}
      {step === STATUS && jobId !== null && <BroadcastJobPanel jobId={jobId} onDone={restart} />}

      {step < STATUS && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            disabled={step === AUDIENCE || isSending}
            onClick={() => {
              setStep(step - 1);
            }}
          >
            {t("back")}
          </Button>
          {step === AUDIENCE && (
            <Button
              disabled={!canLeaveAudience}
              onClick={() => {
                next(AUDIENCE, ["campus_id", "class_ids", "section_ids"]);
              }}
            >
              {t("next")}
            </Button>
          )}
          {step === MESSAGE && (
            <Button
              onClick={() => {
                next(MESSAGE, ["message"]);
              }}
            >
              {t("next")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
