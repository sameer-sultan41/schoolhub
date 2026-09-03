"use client";

import { ApiError, collectPages } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Skeleton,
} from "@schoolhub/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Can } from "@/components/can";
import type { EmergencyContactRecord } from "@/features/students/family-types";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface EmergencyContactsPanelProps {
  studentId: string;
}

export function EmergencyContactsPanel({ studentId }: EmergencyContactsPanelProps) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");

  const contactsQuery = useQuery({
    queryKey: queryKeys.list("students", "emergency-contacts", { studentId }),
    queryFn: () =>
      collectPages<EmergencyContactRecord>(apiClient, `/students/${studentId}/emergency-contacts`, {
        query: { ordering: "priority" },
      }),
  });

  if (contactsQuery.error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(contactsQuery.error.code)
            ? tErrors(contactsQuery.error.code)
            : contactsQuery.error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (contactsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  const contacts = contactsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("emergencyContacts.title")}</h2>
        <Can permission="students.student.update">
          <AddEmergencyContactDialog studentId={studentId} nextPriority={contacts.length + 1} />
        </Can>
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("emergencyContacts.empty")}</p>
      ) : (
        <div className="space-y-3">
          {contacts.map((contact) => (
            <Card key={contact.id}>
              <CardContent className="space-y-1 pt-6">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{contact.name}</p>
                  <Badge variant="outline">
                    {t("emergencyContacts.priority", { priority: contact.priority })}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {contact.relationship} · {contact.phone}
                  {contact.alt_phone ? ` / ${contact.alt_phone}` : ""}
                </p>
                {contact.notes ? (
                  <p className="text-sm text-muted-foreground">{contact.notes}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AddEmergencyContactDialog({
  studentId,
  nextPriority,
}: {
  studentId: string;
  nextPriority: number;
}) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setName("");
    setRelationship("");
    setPhone("");
    setAltPhone("");
    setNotes("");
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/students/${studentId}/emergency-contacts`, {
        name,
        relationship,
        phone,
        alt_phone: altPhone || null,
        priority: nextPriority,
        notes: notes || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "emergency-contacts", { studentId }),
      });
      setOpen(false);
      reset();
    },
  });

  const canSubmit = name.trim() && relationship.trim() && phone.trim();
  const mutationError =
    mutation.error instanceof ApiError
      ? tErrors.has(mutation.error.code)
        ? tErrors(mutation.error.code)
        : mutation.error.message
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{t("emergencyContacts.add")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("guardians.close")}>
        <DialogHeader>
          <DialogTitle>{t("emergencyContacts.add")}</DialogTitle>
          <DialogDescription>{t("emergencyContacts.addDescription")}</DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="danger">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">{t("emergencyContacts.fields.name")}</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-relationship">
              {t("emergencyContacts.fields.relationship")}
            </Label>
            <Input
              id="contact-relationship"
              value={relationship}
              onChange={(event) => {
                setRelationship(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-phone">{t("emergencyContacts.fields.phone")}</Label>
            <Input
              id="contact-phone"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-alt-phone">{t("emergencyContacts.fields.altPhone")}</Label>
            <Input
              id="contact-alt-phone"
              value={altPhone}
              onChange={(event) => {
                setAltPhone(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-notes">{t("emergencyContacts.fields.notes")}</Label>
            <Input
              id="contact-notes"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t("emergencyContacts.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
