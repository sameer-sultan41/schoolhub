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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@schoolhub/ui";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Can } from "@/components/can";
import type {
  GuardianRecord,
  GuardianRelationship,
  StudentGuardianLink,
} from "@/features/students/family-types";
import { GUARDIAN_RELATIONSHIPS } from "@/features/students/student-constants";
import { apiClient } from "@/lib/auth";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { queryKeys } from "@/lib/query-client";

const GUARDIAN_STALE_TIME_MS = 5 * 60_000;

const FLAGS: { key: keyof StudentGuardianLink; labelKey: string }[] = [
  { key: "is_fee_responsible", labelKey: "feeResponsible" },
  { key: "can_pick_up", labelKey: "canPickUp" },
  { key: "receives_communications", labelKey: "receivesCommunications" },
  { key: "has_portal_access", labelKey: "hasPortalAccess" },
];

interface GuardiansPanelProps {
  studentId: string;
}

export function GuardiansPanel({ studentId }: GuardiansPanelProps) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const linksQuery = useQuery({
    queryKey: queryKeys.list("students", "student-guardians", { studentId }),
    queryFn: () => collectPages<StudentGuardianLink>(apiClient, `/students/${studentId}/guardians`),
  });

  const links = linksQuery.data ?? [];
  const guardianIds = [...new Set(links.map((link) => link.guardian_id))];

  const guardianQueries = useQueries({
    queries: guardianIds.map((guardianId) => ({
      queryKey: queryKeys.detail("students", "guardians", guardianId),
      queryFn: async () => (await apiClient.get<GuardianRecord>(`/guardians/${guardianId}`)).data,
      staleTime: GUARDIAN_STALE_TIME_MS,
    })),
  });
  const guardiansById = new Map(
    guardianQueries
      .map((query) => query.data)
      .filter((guardian): guardian is GuardianRecord => Boolean(guardian))
      .map((guardian) => [guardian.id, guardian]),
  );

  const primaryMutation = useMutation({
    mutationFn: (linkId: string) =>
      apiClient.patch(`/student-guardians/${linkId}`, { is_primary: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "student-guardians", { studentId }),
      });
    },
  });

  if (linksQuery.error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(linksQuery.error.code)
            ? tErrors(linksQuery.error.code)
            : linksQuery.error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (linksQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("guardians.title")}</h2>
        <Can permission="students.guardian.create">
          <LinkGuardianDialog studentId={studentId} />
        </Can>
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("guardians.empty")}</p>
      ) : (
        <div className="space-y-3">
          {links.map((link) => {
            const guardian = guardiansById.get(link.guardian_id);
            return (
              <Card key={link.id}>
                <CardContent className="space-y-2 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">
                        {guardian
                          ? `${guardian.first_name} ${guardian.last_name}`
                          : link.guardian_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(`guardians.relationship.${link.relationship}`)}
                        {guardian ? ` · ${guardian.phone}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {link.is_primary ? (
                        <Badge>{t("guardians.primary")}</Badge>
                      ) : (
                        <Can permission="students.guardian.update">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={primaryMutation.isPending}
                            onClick={() => {
                              primaryMutation.mutate(link.id);
                            }}
                          >
                            {t("guardians.makePrimary")}
                          </Button>
                        </Can>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {FLAGS.filter(({ key }) => link[key]).map(({ labelKey }) => (
                      <Badge key={labelKey} variant="outline">
                        {t(`guardians.flags.${labelKey}`)}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LinkGuardianDialog({ studentId }: { studentId: string }) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"search" | "create">("search");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedGuardianId, setSelectedGuardianId] = useState<string | null>(null);
  const [relationship, setRelationship] = useState<GuardianRelationship>("father");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  const searchQuery = useQuery({
    queryKey: queryKeys.list("students", "guardians", { search: debouncedSearch }),
    queryFn: async () =>
      (await apiClient.get<GuardianRecord[]>("/guardians", { query: { search: debouncedSearch } }))
        .data,
    enabled: open && tab === "search" && debouncedSearch.length > 0,
  });

  function reset() {
    setTab("search");
    setSearch("");
    setDebouncedSearch("");
    setSelectedGuardianId(null);
    setRelationship("father");
    setFirstName("");
    setLastName("");
    setPhone("");
  }

  const linkMutation = useMutation({
    mutationFn: async () => {
      const guardianId =
        tab === "create"
          ? (
              await apiClient.post<GuardianRecord>("/guardians", {
                first_name: firstName,
                last_name: lastName,
                phone,
              })
            ).data.id
          : selectedGuardianId;
      return apiClient.post(`/students/${studentId}/guardians`, {
        guardian_id: guardianId,
        relationship,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "student-guardians", { studentId }),
      });
      setOpen(false);
      reset();
    },
  });

  const canSubmit =
    tab === "create"
      ? firstName.trim() && lastName.trim() && phone.trim()
      : Boolean(selectedGuardianId);

  const mutationError =
    linkMutation.error instanceof ApiError
      ? tErrors.has(linkMutation.error.code)
        ? tErrors(linkMutation.error.code)
        : linkMutation.error.message
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
        <Button size="sm">{t("guardians.link")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("guardians.close")}>
        <DialogHeader>
          <DialogTitle>{t("guardians.link")}</DialogTitle>
          <DialogDescription>{t("guardians.linkDescription")}</DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="danger">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            variant={tab === "search" ? "primary" : "outline"}
            size="sm"
            onClick={() => {
              setTab("search");
            }}
          >
            {t("guardians.searchExisting")}
          </Button>
          <Button
            type="button"
            variant={tab === "create" ? "primary" : "outline"}
            size="sm"
            onClick={() => {
              setTab("create");
            }}
          >
            {t("guardians.createNew")}
          </Button>
        </div>

        {tab === "search" ? (
          <div className="space-y-2">
            <Input
              value={search}
              onChange={(event) => {
                onSearchChange(event.target.value);
              }}
              placeholder={t("guardians.searchPlaceholder")}
            />
            {searchQuery.isFetching ? <Skeleton className="h-9 w-full" /> : null}
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {(searchQuery.data ?? []).map((guardian) => (
                <button
                  key={guardian.id}
                  type="button"
                  onClick={() => {
                    setSelectedGuardianId(guardian.id);
                  }}
                  className={`w-full rounded-[var(--sh-radius)] border p-2 text-start text-sm ${
                    selectedGuardianId === guardian.id ? "border-ring bg-muted" : "border-border"
                  }`}
                >
                  {guardian.first_name} {guardian.last_name} · {guardian.phone}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="guardian-first-name">{t("guardians.fields.firstName")}</Label>
              <Input
                id="guardian-first-name"
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guardian-last-name">{t("guardians.fields.lastName")}</Label>
              <Input
                id="guardian-last-name"
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guardian-phone">{t("guardians.fields.phone")}</Label>
              <Input
                id="guardian-phone"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="guardian-relationship">{t("guardians.fields.relationship")}</Label>
          <Select
            value={relationship}
            onValueChange={(value) => {
              setRelationship(value as GuardianRelationship);
            }}
          >
            <SelectTrigger id="guardian-relationship">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GUARDIAN_RELATIONSHIPS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`guardians.relationship.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={!canSubmit || linkMutation.isPending}
            onClick={() => {
              linkMutation.mutate();
            }}
          >
            {t("guardians.link")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
