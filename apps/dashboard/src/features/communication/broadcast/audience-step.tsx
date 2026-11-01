"use client";

import { useTranslations } from "next-intl";
import { Alert, Checkbox, Label, RadioGroup, RadioGroupItem } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { useCampuses, useClasses, useSections } from "@/hooks/use-reference-data";
import { BROADCAST_AUDIENCE_TYPES } from "@/services/modules/broadcasts/broadcasts-constant";

import type { BroadcastFormValues } from "./broadcast-form-schema";

export interface AudienceStepProps {
  values: BroadcastFormValues;
  onChange: (patch: Partial<BroadcastFormValues>) => void;
  /** The class and section pickers' failed rule, already translated. */
  errors: { class_ids?: string; section_ids?: string };
}

interface ChecklistProps {
  legend: string;
  options: readonly { id: string; name: string }[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}

function Checklist({ legend, options, selected, onChange }: ChecklistProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      {options.map((option) => (
        <div key={option.id} className="flex items-center gap-2">
          <Checkbox
            id={`broadcast-${option.id}`}
            checked={selected.includes(option.id)}
            onCheckedChange={(checked) => {
              onChange(
                checked === true
                  ? [...selected, option.id]
                  : selected.filter((id) => id !== option.id),
              );
            }}
          />
          <Label htmlFor={`broadcast-${option.id}`}>{option.name}</Label>
        </div>
      ))}
    </fieldset>
  );
}

/** Step 1: who the broadcast goes to. A class or section audience adds its own pickers. */
export function AudienceStep({ values, onChange, errors }: AudienceStepProps) {
  const t = useTranslations("communication.broadcast.audience");
  const campuses = useCampuses();
  const classes = useClasses({ isActive: true });
  const sections = useSections(values.section_class_id, { isActive: true });
  const isClass = values.audience_type === "class";
  const isSection = values.audience_type === "section";

  return (
    <div className="space-y-5">
      <RadioGroup
        aria-label={t("label")}
        value={values.audience_type}
        onValueChange={(next) => {
          const picked = BROADCAST_AUDIENCE_TYPES.find((type) => type === next);
          if (picked) onChange({ audience_type: picked });
        }}
      >
        {BROADCAST_AUDIENCE_TYPES.map((type) => (
          <div key={type} className="flex items-center gap-2">
            <RadioGroupItem id={`broadcast-audience-${type}`} value={type} />
            <Label htmlFor={`broadcast-audience-${type}`}>{t(`types.${type}`)}</Label>
          </div>
        ))}
      </RadioGroup>

      <FilterSelect
        label={t("campus")}
        allLabel={t("allCampuses")}
        value={values.campus_id}
        onChange={(campusId) => {
          onChange({ campus_id: campusId });
        }}
        options={campuses.data ?? []}
      />

      {isClass && (
        <Checklist
          legend={t("classes")}
          options={classes.data ?? []}
          selected={values.class_ids}
          onChange={(ids) => {
            onChange({ class_ids: ids });
          }}
        />
      )}
      {isClass && errors.class_ids && <Alert variant="destructive">{errors.class_ids}</Alert>}

      {isSection && (
        <div className="space-y-4">
          <FilterSelect
            label={t("classForSections")}
            value={values.section_class_id}
            onChange={(classId) => {
              onChange({ section_class_id: classId, section_ids: [] });
            }}
            options={classes.data ?? []}
          />
          {values.section_class_id !== "" && (
            <Checklist
              legend={t("sections")}
              options={sections.data ?? []}
              selected={values.section_ids}
              onChange={(ids) => {
                onChange({ section_ids: ids });
              }}
            />
          )}
          {values.section_class_id !== "" && sections.isError && (
            <Alert variant="destructive">{t("sectionsFailed")}</Alert>
          )}
        </div>
      )}
      {isSection && errors.section_ids && <Alert variant="destructive">{errors.section_ids}</Alert>}
    </div>
  );
}
