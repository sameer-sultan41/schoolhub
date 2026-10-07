"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Skeleton,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useGuardedSubmit, useSubmitGuard } from "@/hooks/use-submit-guard";
import { applyServerFieldErrors } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  emergencyContactSchema,
  type EmergencyContactFormValues,
} from "@/services/modules/students/students.schema";

export interface StudentEmergencyContactsTabProps {
  studentId: string;
  canCreate: boolean;
}

export function StudentEmergencyContactsTab({
  studentId,
  canCreate,
}: StudentEmergencyContactsTabProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const [dialogOpen, setDialogOpen] = useState(false);

  const contactsQuery = useQuery({
    queryKey: queryKeys.list("students", "emergency-contacts", { studentId }),
    queryFn: () => Services.students.fetchEmergencyContacts(studentId),
  });
  const contacts = contactsQuery.data ?? [];

  if (contactsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (contactsQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("emergencyContacts.loadError")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void contactsQuery.refetch();
          }}
        >
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("emergencyContacts.title")}</h3>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            {t("emergencyContacts.add")}
          </Button>
        )}
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("emergencyContacts.empty")}</p>
      ) : (
        <div className="space-y-3">
          {contacts.map((contact) => (
            <div key={contact.id} className="space-y-1 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{contact.name}</p>
                <Badge variant="outline">
                  {/* `priority` is optional only because the backend field has a server-side
                   * default (`PositiveSmallIntegerField(default=1)`, never null); `?? 1` matches that default. */}
                  {t("emergencyContacts.priority", { priority: contact.priority ?? 1 })}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {contact.relationship} · {contact.phone}
                {contact.alt_phone ? ` / ${contact.alt_phone}` : ""}
              </p>
              {contact.notes ? (
                <p className="text-xs text-muted-foreground">{contact.notes}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {dialogOpen && (
        <AddEmergencyContactDialog
          studentId={studentId}
          nextPriority={contacts.length + 1}
          onOpenChange={(open) => {
            if (!open) setDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AddEmergencyContactDialog({
  studentId,
  nextPriority,
  onOpenChange,
}: {
  studentId: string;
  nextPriority: number;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const form = useForm<EmergencyContactFormValues>({
    resolver: zodResolver(emergencyContactSchema),
    defaultValues: {
      name: "",
      relationship: "",
      phone: "",
      alt_phone: "",
      priority: nextPriority,
      notes: "",
    },
  });
  const submitGuard = useSubmitGuard();

  const mutation = useMutation({
    mutationFn: (values: EmergencyContactFormValues) =>
      Services.students.addEmergencyContact(studentId, {
        name: values.name,
        relationship: values.relationship,
        phone: values.phone,
        ...(values.alt_phone ? { altPhone: values.alt_phone } : {}),
        priority: values.priority,
        ...(values.notes ? { notes: values.notes } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "emergency-contacts", { studentId }),
      });
      onOpenChange(false);
    },
    // A matched 422 field error lands inline on its own field (via `applyServerFieldErrors`,
    // same helper `GuardianFormDialog`/`GuardianLinkFlagsDialog` use); anything unmatched
    // still surfaces via toast, keeping this a "mutations don't fail silently" case per
    // this plan's Global Constraints even for the non-field fallback. Round-6 review: the
    // previous toast-only handling showed a generic "add failed" message even when the
    // server named a specific bad field, with nothing on the form to show it was that field.
    onError: (error) => {
      applyServerFieldErrors({
        error,
        form,
        knownFields: Object.keys(emergencyContactSchema.shape),
        tErrors,
        fallback: t("emergencyContacts.addFailed"),
        setFormError: (message) => {
          if (message) toast.error(message);
        },
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
    <ResponsiveDialog open onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("emergencyContacts.add")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={handleSubmit}>
            <ResponsiveDialogBody className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("emergencyContacts.addDescription")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("emergencyContacts.permanentNotice")}
              </p>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.name")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="relationship"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.relationship")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.phone")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="alt_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.altPhone")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.priority")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        {...field}
                        onChange={(event) => {
                          // `valueAsNumber` is `NaN` for an empty/cleared input (the DOM's
                          // own contract, not a bug) — writing that straight into the form
                          // let zod's raw "Expected number, received nan" reach the user
                          // instead of a normal required-field message. `undefined` is what
                          // every other optional-at-the-type-level field in this form (e.g.
                          // `alt_phone`) ends up as once `applyServerFieldErrors`/zod sees a
                          // cleared value; `emergencyContactSchema.priority`'s own `error` map
                          // (students.schema.ts) turns that into a friendly "required" message.
                          const value = event.target.valueAsNumber;
                          onChange(Number.isNaN(value) ? undefined : value);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.notes")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
              <Button
                type="submit"
                isLoading={mutation.isPending}
                loadingLabel={t("emergencyContacts.submitting")}
              >
                {t("emergencyContacts.add")}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
