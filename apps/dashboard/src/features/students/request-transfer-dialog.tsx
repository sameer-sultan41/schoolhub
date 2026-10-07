"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm, type Resolver } from "react-hook-form";
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
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { useGuardedSubmit, useSubmitGuard } from "@/hooks/use-submit-guard";
import { applyServerFieldErrors } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  requestTransferFormSchema,
  type RequestTransferFormValues,
} from "@/services/modules/student-transfers/student-transfers.schema";
import { formValuesToRequestTransferInput } from "@/services/modules/student-transfers/student-transfers-helper";

/**
 * RHF's internal value store is one flat object, not a true discriminated union — only
 * `requestTransferFormSchema` (via `zodResolver`) actually discriminates on submit. This
 * flat shape carries every field from both branches; whichever don't apply to the current
 * `transfer_type` are simply not rendered, and `requestTransferFormSchema`'s own
 * discriminated union strips them before `formValuesToRequestTransferInput` ever sees them.
 */
interface RequestTransferFormState {
  transfer_type: "inter_campus" | "outgoing";
  from_campus_id: string;
  to_campus_id: string;
  external_school_name: string;
  reason: string;
  effective_date: string;
}

export interface RequestTransferDialogProps {
  studentId: string;
  currentCampusId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestTransferDialog({
  studentId,
  currentCampusId,
  open,
  onOpenChange,
}: RequestTransferDialogProps) {
  const tCommon = useTranslations("common");
  const t = useTranslations("students");
  const isMobile = !useIsDesktopShell();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("transfers.request")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {open ? (
          <RequestTransferBody
            studentId={studentId}
            currentCampusId={currentCampusId}
            isMobile={isMobile}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface RequestTransferBodyProps {
  studentId: string;
  currentCampusId: string;
  isMobile: boolean;
  onOpenChange: (open: boolean) => void;
}

function RequestTransferBody({
  studentId,
  currentCampusId,
  isMobile,
  onOpenChange,
}: RequestTransferBodyProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const submitGuard = useSubmitGuard();
  const [formError, setFormError] = useState<string | null>(null);

  const campusesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => Services.dashboard.fetchCampuses(),
  });
  const currentCampus = useMemo(
    () => (campusesQuery.data ?? []).find((campus) => campus.id === currentCampusId),
    [campusesQuery.data, currentCampusId],
  );
  const destinationCampuses = useMemo(
    () => (campusesQuery.data ?? []).filter((campus) => campus.id !== currentCampusId),
    [campusesQuery.data, currentCampusId],
  );

  const form = useForm<RequestTransferFormState>({
    resolver: zodResolver(requestTransferFormSchema) as Resolver<RequestTransferFormState>,
    defaultValues: {
      transfer_type: "inter_campus",
      from_campus_id: currentCampusId,
      to_campus_id: "",
      external_school_name: "",
      reason: "",
      effective_date: "",
    },
  });
  const transferType = form.watch("transfer_type");

  const mutation = useMutation({
    mutationFn: (values: RequestTransferFormState) =>
      Services.studentTransfers.requestTransfer(
        studentId,
        formValuesToRequestTransferInput(values as RequestTransferFormValues),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("student-transfers", "transfers", { studentId }),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "history", { studentId }),
      });
      onOpenChange(false);
    },
    onError: (error) => {
      applyServerFieldErrors({
        error,
        form,
        knownFields: [
          "transfer_type",
          "to_campus_id",
          "external_school_name",
          "reason",
          "effective_date",
        ],
        tErrors,
        fallback: t("form.submitFailed"),
        setFormError,
      });
    },
  });

  const handleSubmit = useGuardedSubmit(
    form,
    submitGuard,
    (values) =>
      new Promise<void>((resolve) => {
        mutation.mutate(values, {
          onSettled: () => {
            resolve();
          },
        });
      }),
  );

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={handleSubmit}
        className={isMobile ? "flex min-h-0 grow flex-col" : undefined}
      >
        <ResponsiveDialogBody
          className={
            isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
          }
        >
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <FormField
            control={form.control}
            name="transfer_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("transfers.fields.type")}</FormLabel>
                <RadioGroup
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                  }}
                  className="flex gap-4"
                >
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="inter_campus" />
                    {t("transfers.type.inter_campus")}
                  </label>
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="outgoing" />
                    {t("transfers.type.outgoing")}
                  </label>
                </RadioGroup>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormItem>
            <FormLabel>{t("transfers.fields.fromCampus")}</FormLabel>
            <p className="text-sm">{currentCampus?.name}</p>
          </FormItem>
          {transferType === "inter_campus" ? (
            <FormField
              control={form.control}
              name="to_campus_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("transfers.fields.toCampus")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("enrollment.fields.selectCampus")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {destinationCampuses.map((campus) => (
                        <SelectItem key={campus.id} value={campus.id}>
                          {campus.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="external_school_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("transfers.fields.externalSchoolName")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("transfers.fields.reason")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="effective_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("transfers.fields.effectiveDate")}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tCommon("cancel")}
          </Button>
          <Button type="submit" isLoading={mutation.isPending} loadingLabel={t("form.submitting")}>
            {t("transfers.request")}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </Form>
  );
}
