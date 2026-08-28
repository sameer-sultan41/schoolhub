"use client";

import { useState } from "react";

/**
 * Public form submission.
 *
 * Posts **from the browser** straight to the public API endpoint, so the renderer's
 * read-only machine token is never involved (website-builder.md §6). The endpoints are
 * tenant-resolved and re-validated server-side, rate-limited per IP and per tenant, and
 * idempotency-protected — none of which we can or should reimplement here.
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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
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
      <p role="status" className="text-sm text-foreground">
        Thank you — we have received your message and will be in touch.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="enquiry-name" className="block text-sm font-medium text-foreground">
          Your name
        </label>
        <input
          id="enquiry-name"
          name="name"
          required
          maxLength={120}
          autoComplete="name"
          className="h-10 w-full rounded-[var(--sh-radius)] border border-black/15 px-3 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="enquiry-email" className="block text-sm font-medium text-foreground">
          Email
        </label>
        <input
          id="enquiry-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          className="h-10 w-full rounded-[var(--sh-radius)] border border-black/15 px-3 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="enquiry-message" className="block text-sm font-medium text-foreground">
          Message
        </label>
        <textarea
          id="enquiry-message"
          name="message"
          required
          rows={5}
          maxLength={2000}
          className="w-full rounded-[var(--sh-radius)] border border-black/15 px-3 py-2 text-sm"
        />
      </div>

      {status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          We could not send your message. Please try again in a moment.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        aria-busy={status === "submitting"}
        className="h-11 rounded-[var(--sh-radius)] bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {status === "submitting" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
