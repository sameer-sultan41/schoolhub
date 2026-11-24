import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { filterMenuByAccess } from "@/app/(app)/shell/menu-access";
import { MENU_SIDEBAR } from "@/config/menu-config";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { buildUser } from "@/test-utils";
import messages from "../../../../messages/en.json";

import { PlatformMfaGate } from "../platform-mfa-gate";
import { apiError, platformUser } from "./platform-fixtures";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ platformServicesMock: () => unknown }>("./platform-services-mock")
    .platformServicesMock(),
);

const auth = Services.auth as jest.Mocked<typeof Services.auth>;

function platformMenu(permissions: Parameters<typeof buildUser>[0]) {
  return filterMenuByAccess(MENU_SIDEBAR, buildUser(permissions)).find(
    (item) => item.title === "Platform",
  );
}

describe("the console's sidebar entry", () => {
  it("shows each section to an operator holding its view key", () => {
    const entry = platformMenu(["platform.tenant.view", "platform.report.view"]);

    expect(entry?.children?.map((child) => child.path)).toEqual([
      "/platform/tenants",
      "/platform/reports",
    ]);
  });

  it("never shows to a school account, whose platform.* keys are tenant-scope", () => {
    // `school_owner` holds these (files, jobs, notifications); none opens the console.
    expect(
      platformMenu(["platform.file.view", "platform.job.view", "platform.notification.view"]),
    ).toBeUndefined();
  });
});

function renderGate(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <PlatformMfaGate>
          <p>console</p>
        </PlatformMfaGate>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return queryClient;
}

describe("PlatformMfaGate", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    auth.fetchCurrentUser.mockReset();
  });

  it("sends an operator without TOTP to enrol, showing nothing of the console", async () => {
    auth.fetchCurrentUser.mockResolvedValue({ ...platformUser([]), mfa_enabled: false });

    renderGate();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/mfa/enroll");
    });
    expect(screen.queryByText("console")).not.toBeInTheDocument();
  });

  it("shows the console to an enrolled operator", async () => {
    auth.fetchCurrentUser.mockResolvedValue(platformUser([]));

    renderGate();

    expect(await screen.findByText("console")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("sends the operator to enrol when a console read is refused mfa_required", async () => {
    auth.fetchCurrentUser.mockResolvedValue(platformUser([]));
    const queryClient = renderGate();
    await screen.findByText("console");

    // `IsPlatformPrincipal`'s 403 for a token without the second factor.
    const refused = apiError(403, "mfa_required", "Second factor required.");
    await act(async () => {
      await queryClient
        .fetchQuery({
          queryKey: queryKeys.list("platform", "tenants", {}),
          queryFn: () => Promise.reject(refused),
        })
        .catch(() => undefined);
    });

    expect(mockReplace).toHaveBeenCalledWith("/mfa/enroll");
  });
});
