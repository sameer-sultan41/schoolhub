"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Skeleton,
} from "@schoolhub/ui";

import { formatDate } from "@/lib/helpers";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { DocumentVerificationDecision, StudentDocumentRecord } from "@/services";
import { DOCUMENT_TYPES } from "@/services/modules/students/students-constant";
import { DocumentUploadDialog } from "./document-upload-dialog";

const STATUS_VARIANT: Record<
  StudentDocumentRecord["verification_status"],
  "success" | "warning" | "destructive"
> = {
  pending: "warning",
  verified: "success",
  rejected: "destructive",
};

/** A tenant's document can carry a `document_type` outside the 6 seeded defaults (an
 * older or externally-written row) — render the raw value rather than indexing into the
 * fixed `documents.type.*` i18n map and hitting a missing key. */
function documentTypeLabel(t: ReturnType<typeof useTranslations>, type: string): string {
  return (DOCUMENT_TYPES as readonly string[]).includes(type) ? t(`documents.type.${type}`) : type;
}

// A document's expiry date is never shown to the user as a raw ISO string — `formatDate`
// (`@/lib/helpers`) is the same "January 5, 2026"-style formatter the staff detail sheet
// already uses for its own absolute dates (joining date, date of birth). Round-6 review:
// this task originally defined its own byte-identical `formatExpiry`, which would have
// been a third copy once this phase shipped — `staff-helper.ts`'s own `formatDate` moves
// to `@/lib/helpers` in this same task (see the file list above) specifically so both
// domains share one implementation instead.

export interface StudentDocumentsTabProps {
  studentId: string;
  canCreate: boolean;
  canVerify: boolean;
  canDelete: boolean;
}

export function StudentDocumentsTab({
  studentId,
  canCreate,
  canVerify,
  canDelete,
}: StudentDocumentsTabProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const queryClient = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const documentsQuery = useQuery({
    queryKey: queryKeys.list("students", "documents", { studentId }),
    queryFn: () => Services.students.fetchDocuments(studentId),
  });
  const documents = documentsQuery.data ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("students", "documents", { studentId }),
    });
  }

  const verifyMutation = useMutation({
    mutationFn: ({
      documentId,
      decision,
    }: {
      documentId: string;
      decision: DocumentVerificationDecision;
    }) => Services.students.verifyDocument(documentId, decision),
    onSuccess: invalidate,
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("documents.verifyFailed")));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => Services.students.deleteDocument(documentId),
    onSuccess: () => {
      invalidate();
      setPendingDeleteId(null);
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("documents.deleteFailed")));
    },
  });

  const downloadMutation = useMutation({
    // `Services.students.getDocumentDownloadUrl` (Task 3), keyed on the document's own
    // id — Task 1's new `students.document.view`-gated `:download` action, not the
    // generic `Services.jobs.fetchFileDownloadUrl` that `/staff`'s export still uses.
    // Takes the document's own title alongside its id, purely for the anchor's
    // `download` filename hint below — never sent to the server.
    mutationFn: async ({ documentId }: { documentId: string; title: string }) => ({
      url: await Services.students.getDocumentDownloadUrl(documentId),
    }),
    onSuccess: ({ url }, { title }) => {
      // The anchor-click pattern `/staff`'s export download already uses — never
      // `window.open`, which only succeeds within a short window of direct user
      // interaction that the request in between can lose on a slow connection. The
      // `download` attribute is a same-origin filename hint only; the actual forced
      // download now comes from `core/files`' own `Content-Disposition` header (Task 1).
      const link = document.createElement("a");
      link.href = url;
      link.download = title;
      link.click();
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("documents.downloadFailed")));
    },
  });

  if (documentsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (documentsQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("documents.loadError")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void documentsQuery.refetch();
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
        <h3 className="text-sm font-semibold text-foreground">{t("documents.title")}</h3>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setUploadOpen(true);
            }}
          >
            {t("documents.upload")}
          </Button>
        )}
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("documents.empty")}</p>
      ) : (
        <div className="space-y-3">
          {documents.map((document) => (
            <div key={document.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{document.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {documentTypeLabel(t, document.document_type)}
                    {document.expires_at
                      ? ` · ${t("documents.expiresOn", { date: formatDate(document.expires_at, locale) })}`
                      : ""}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[document.verification_status]} appearance="light">
                  {t(`documents.status.${document.verification_status}`)}
                </Badge>
              </div>
              {/* Row-specific accessible names (WCAG 2.4.6) below — every row otherwise
               * shares the exact same button text, so a screen-reader user can't tell
               * which document "Download"/"Verify"/"Reject"/"Delete" would act on. */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloadMutation.isPending}
                  aria-label={`${t("documents.download")} — ${document.title}`}
                  onClick={() => {
                    downloadMutation.mutate({ documentId: document.id, title: document.title });
                  }}
                >
                  {t("documents.download")}
                </Button>
                {canVerify && document.verification_status === "pending" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={verifyMutation.isPending}
                      aria-label={`${t("documents.verify")} — ${document.title}`}
                      onClick={() => {
                        verifyMutation.mutate({ documentId: document.id, decision: "verified" });
                      }}
                    >
                      {t("documents.verify")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={verifyMutation.isPending}
                      aria-label={`${t("documents.reject")} — ${document.title}`}
                      onClick={() => {
                        verifyMutation.mutate({ documentId: document.id, decision: "rejected" });
                      }}
                    >
                      {t("documents.reject")}
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`${t("documents.delete")} — ${document.title}`}
                    onClick={() => {
                      setPendingDeleteId(document.id);
                    }}
                  >
                    {t("documents.delete")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadOpen && (
        <DocumentUploadDialog
          open
          studentId={studentId}
          onOpenChange={(open) => {
            if (!open) setUploadOpen(false);
          }}
          onUploaded={invalidate}
        />
      )}

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("documents.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("documents.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDeleteId) deleteMutation.mutate(pendingDeleteId);
              }}
            >
              {/* A real delete-action verb, not the confirmation question repeated as its
               * own button label — reuses the same `documents.delete` key the row's own
               * trigger button already uses. */}
              {t("documents.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
