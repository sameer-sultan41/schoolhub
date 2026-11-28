import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import enMessages from "../../../../../messages/en.json";
import urMessages from "../../../../../messages/ur.json";
import { apiError, TENANT_ID } from "@/features/platform/__tests__/platform-fixtures";

import { usePlatformErrorDescriber } from "../use-platform-error";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {},
}));

function describer(locale: "en" | "ur") {
  const messages = locale === "en" ? enMessages : urMessages;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    );
  }
  return renderHook(() => usePlatformErrorDescriber(), { wrapper: Wrapper }).result.current;
}

const OTHER_TENANT = "0f1e2d3c-4b5a-4968-8776-655443322110";

describe("usePlatformErrorDescriber", () => {
  it("counts the schools over a lowered limit, not the breaches", () => {
    // One school over two metrics is one school.
    const error = apiError(409, "limit_below_usage", "Below usage.", {
      meta: {
        over_usage: [
          { tenant_id: TENANT_ID, metric: "students", limit: 100, usage: 320 },
          { tenant_id: TENANT_ID, metric: "staff", limit: 10, usage: 41 },
          { tenant_id: OTHER_TENANT, metric: "staff", limit: 10, usage: 12 },
        ],
      },
    });

    expect(describer("en")(error)).toBe("2 schools are already over a limit this lowers.");
  });

  it("names the flag, and keeps the server's English reason out of Urdu", () => {
    const reason = "Published timetables still use this module.";
    const error = apiError(409, "toggle_refused", reason, { meta: { flag: "module.timetable" } });

    expect(describer("en")(error)).toBe(
      `module.timetable can't be changed for this school: ${reason}`,
    );
    const urdu = describer("ur")(error);
    expect(urdu).toContain("module.timetable");
    expect(urdu).not.toContain(reason);
  });
});
