import { getRequestConfig } from "next-intl/server";

// Minimal stub so next.config.ts's createNextIntlPlugin registration has a
// request config to load — this preview route does no i18n work of its own.
export default getRequestConfig(() => ({
  locale: "en",
  messages: {},
}));
