"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Alert,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
} from "@schoolhub/ui";

import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type GradeBandRecord } from "@/services";
import {
  BAND_ERROR_FIELDS,
  BAND_LABEL_MAX,
  BAND_REMARK_MAX,
  GRADING_SCALES_QUERY_MODULE,
} from "@/services/modules/grading-scales/grading-scales-constant";
import {
  buildBandInput,
  defaultBandFormValues,
  recordToBandFormValues,
} from "@/services/modules/grading-scales/grading-scales-helper";
import {
  createBandFormSchema,
  type BandFormValues,
} from "@/services/modules/grading-scales/grading-scales.schema";

/** The plain inputs, in form order: same shape, one render. A field with no max length is a
 * number, entered as a decimal string; `integer` marks the whole-number one (`type="number"`). */
const INPUT_FIELDS: ReadonlyArray<{
  name: Exclude<keyof BandFormValues, "is_passing">;
  labelKey: string;
  maxLength?: number;
  integer?: boolean;
}> = [
  { name: "label", labelKey: "label", maxLength: BAND_LABEL_MAX },
  { name: "min_percent", labelKey: "minPercent" },
  { name: "max_percent", labelKey: "maxPercent" },
  { name: "grade_point", labelKey: "gradePoint" },
  { name: "sort_order", labelKey: "sortOrder", integer: true },
  { name: "remark", labelKey: "remark", maxLength: BAND_REMARK_MAX },
];

export interface GradeBandFormProps {
  scaleId: string;
  /** The band to edit; omitted to add one. */
  band?: GradeBandRecord;
  /** Where an added band goes in the order: after the last. */
  nextSortOrder: number;
  onDone: () => void;
}

/**
 * Adds a band to a scale, or edits one, inline under the band list. A server error that names a
 * field (a lower bound not below the upper, say) is shown under it; any other is the form's own
 * message.
 *
 * Mounting contract: the editor mounts this only while a band is being added or edited, and
 * keys it on the band, so each one starts from a fresh form.
 */
export function GradeBandForm({ scaleId, band, nextSortOrder, onDone }: GradeBandFormProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateScales = useInvalidateModule(GRADING_SCALES_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createBandFormSchema({
        required: tCommon("requiredField"),
        decimalInvalid: t("gradingScales.form.decimalInvalid"),
        orderInvalid: t("gradingScales.bands.form.orderInvalid"),
      }),
    [t, tCommon],
  );
  const form = useForm<BandFormValues>({
    resolver: zodResolver(schema),
    defaultValues: band ? recordToBandFormValues(band) : defaultBandFormValues(nextSortOrder),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: BandFormValues) =>
      band
        ? Services.gradingScales.updateBand(scaleId, band.id, buildBandInput(values))
        : Services.gradingScales.createBand(scaleId, buildBandInput(values)),
    knownFields: BAND_ERROR_FIELDS,
    onSuccess: () => {
      invalidateScales();
      toast.success(t("gradingScales.bands.saved"));
      onDone();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={handleSubmit}
        aria-label={
          band ? t("gradingScales.bands.form.editTitle") : t("gradingScales.bands.form.createTitle")
        }
        className="space-y-4 rounded-lg border border-border p-4"
      >
        <h3 className="text-sm font-semibold">
          {band
            ? t("gradingScales.bands.form.editTitle")
            : t("gradingScales.bands.form.createTitle")}
        </h3>
        {formError && <Alert variant="destructive">{formError}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {INPUT_FIELDS.map(({ name, labelKey, maxLength, integer }) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t(`gradingScales.bands.form.${labelKey}`)}</FormLabel>
                  <FormControl>
                    {integer ? (
                      <Input type="number" min={0} step={1} inputMode="numeric" {...field} />
                    ) : (
                      <Input
                        maxLength={maxLength}
                        inputMode={maxLength === undefined ? "decimal" : undefined}
                        {...field}
                      />
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
        <FormField
          control={form.control}
          name="is_passing"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between gap-3">
                <FormLabel>{t("gradingScales.bands.form.isPassing")}</FormLabel>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" isLoading={isPending} loadingLabel={tCommon("saving")}>
            {tCommon("save")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
