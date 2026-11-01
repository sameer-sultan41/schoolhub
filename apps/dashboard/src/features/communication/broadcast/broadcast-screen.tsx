"use client";

import { useMemo, useState } from "react";
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
  type BroadcastFormValues,
} from "./broadcast-form-schema";
import { ConfirmStep } from "./confirm-step";
import { MessageStep } from "./message-step";

const STEPS = ["audience", "message", "confirm", "status"] as const;
const [AUDIENCE, MESSAGE, CONFIRM, STATUS] = [1, 2, 3, 4];

type StepErrors = Partial<Record<keyof BroadcastFormValues, string>>;

/**
 * The Emergency broadcast wizard: audience, message, a previewed confirmation and the job's
 * status. A step's Next validates only its own fields; the confirm step previews the exact
 * request the earlier steps built.
 */
export function BroadcastScreen() {
  const t = useTranslations("communication.broadcast");
  const [values, setValues] = useState<BroadcastFormValues>(BROADCAST_DEFAULTS);
  const [step, setStep] = useState(AUDIENCE);
  const [errors, setErrors] = useState<StepErrors>({});
  const [jobId, setJobId] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      createBroadcastSchema({
        classRequired: t("errors.classRequired"),
        sectionRequired: t("errors.sectionRequired"),
        messageRequired: t("errors.messageRequired"),
        messageTooLong: t("errors.messageTooLong", { max: BROADCAST_MESSAGE_MAX_LENGTH }),
      }),
    [t],
  );

  function update(patch: Partial<BroadcastFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
    setErrors({});
  }

  /** Moves on from `from` when its own fields pass the schema. */
  function next(from: number, fields: (keyof BroadcastFormValues)[]) {
    const result = schema.safeParse(values);
    const found: StepErrors = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof BroadcastFormValues;
        if (fields.includes(field)) found[field] ??= issue.message;
      }
    }
    setErrors(found);
    if (Object.keys(found).length === 0) setStep(from + 1);
  }

  function restart() {
    setValues(BROADCAST_DEFAULTS);
    setErrors({});
    setJobId(null);
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
          errors={{ class_ids: errors.class_ids, section_ids: errors.section_ids }}
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
            disabled={step === AUDIENCE}
            onClick={() => {
              setStep(step - 1);
            }}
          >
            {t("back")}
          </Button>
          {step === AUDIENCE && (
            <Button
              onClick={() => {
                next(AUDIENCE, ["class_ids", "section_ids"]);
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
