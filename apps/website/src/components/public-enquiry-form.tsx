"use client";

import { Alert, AlertDescription, Button, Input, Label, Textarea } from "@schoolhub/ui";
import { useState } from "react";

/**
 * Public form submission.
 *
 * Posts **from the browser** straight to the public API endpoint, so the renderer's
 * read-only machine token is never involved (website-builder.md §6). The endpoints are
 * tenant-resolved and re-validated server-side, rate-limited per IP and per tenant, and
 * idempotency-protected — none of which we can or should reimplement here.
 *
 * Uncontrolled + native HTML5 validation (required/type=email/maxLength) rather than
 * react-hook-form's Form/FormField set: three fields with no interdependent validation
 * don't need it, and this app has never had a form-state dependency — pulling one in for
 * this would be solving a problem this form doesn't have. Only the styling layer moves
 * onto the shared components (Label/Input/Textarea/Button/Alert).
 */
const ENDPOINTS = {
  contact: "/api/v1/public/contact-messages",
  admission_enquiry: "/api/v1/public/admission-enquiries",
} as const;

type Status = "idle" | "submitting" | "sent" | "error";

export function PublicEnquiryForm({
  kind,
  tenantSlug,
}: {
  kind: keyof typeof ENDPOINTS;
  tenantSlug: string;
}) {
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_ORIGIN ?? ""}${ENDPOINTS[kind]}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Re-validated server-side against the request's host; never trusted as-is.
            "X-Tenant-Slug": tenantSlug,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(Object.fromEntries(form.entries())),
        },
      );
      setStatus(response.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <Alert variant="success" role="status">
        <AlertDescription>
          Thank you — we have received your message and will be in touch.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    // onSubmit is async and already catches its own errors internally (setStatus("error")
    // never throws out), so `void` here only satisfies onSubmit's void-returning type —
    // there is nothing left for a caller to await or handle.
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="enquiry-name">Your name</Label>
        <Input id="enquiry-name" name="name" required maxLength={120} autoComplete="name" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="enquiry-email">Email</Label>
        <Input
          id="enquiry-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="enquiry-message">Message</Label>
        <Textarea id="enquiry-message" name="message" required rows={5} maxLength={2000} />
      </div>

      {status === "error" ? (
        <Alert variant="danger">
          <AlertDescription>
            We could not send your message. Please try again in a moment.
          </AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" isLoading={status === "submitting"} loadingLabel="Sending">
        Send message
      </Button>
    </form>
  );
}
