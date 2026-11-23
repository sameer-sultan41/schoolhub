/**
 * The renderer's visible strings, English only (website-cms plan, Deferred: renderer i18n).
 * One map, so a later i18n pass has a single source to translate.
 */
export const COPY = {
  form: {
    /** Neutral: a person who reaches the honeypot anyway is told to skip it, not what it is. */
    honeypotLabel: "Leave this field empty",
  },
  unavailable: {
    title: "This website is unavailable",
    body: "The site is temporarily offline. Please contact the school directly.",
    metadataTitle: "Not available",
  },
  preview: {
    label: "Preview",
    body: "You are viewing unpublished content.",
    exit: "Exit preview",
  },
  navigation: {
    primary: "Primary",
  },
  footer: {
    socialLinks: "Social media",
    primaryLinks: "Footer",
    secondaryLinks: "Footer secondary",
  },
  faq: {
    heading: "Frequently asked questions",
  },
  events: {
    allDay: "All day",
  },
  gallery: {
    watchVideo: "Watch video",
    itemCount: (shown: number, total: number) => `Showing ${shown} of ${total} items`,
  },
} as const;
