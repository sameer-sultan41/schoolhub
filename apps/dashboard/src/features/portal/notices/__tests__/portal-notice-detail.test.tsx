import { ApiError } from "@schoolhub/api-client";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { NOTICE_ID, portalNotice } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalNoticeDetail } from "../portal-notice-detail";

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({ notices: ["fetchNotice", "acknowledgeNotice"] }),
);

const mockFetch = Services.notices.fetchNotice as jest.MockedFunction<
  typeof Services.notices.fetchNotice
>;
const mockAcknowledge = Services.notices.acknowledgeNotice as jest.MockedFunction<
  typeof Services.notices.acknowledgeNotice
>;

describe("PortalNoticeDetail", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockAcknowledge.mockReset();
  });

  it("notice acknowledge hides button after success", async () => {
    mockFetch.mockResolvedValue(portalNotice());
    mockAcknowledge.mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithProviders(<PortalNoticeDetail noticeId={NOTICE_ID} />);
    await user.click(await screen.findByRole("button", { name: "Acknowledge" }));

    expect(mockAcknowledge).toHaveBeenCalledWith(NOTICE_ID);
    expect(await screen.findByText("Acknowledged")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
  });

  it("offers no Acknowledge when none is required or it was already given", async () => {
    mockFetch.mockResolvedValue(portalNotice({ requires_acknowledgment: false }));

    const { unmount } = renderWithProviders(<PortalNoticeDetail noticeId={NOTICE_ID} />);
    expect(await screen.findByText("Sports day")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    unmount();

    mockFetch.mockResolvedValue(portalNotice({ acknowledged_at: "2026-11-03T08:00:00Z" }));
    renderWithProviders(<PortalNoticeDetail noticeId={NOTICE_ID} />);
    expect(await screen.findByText("Acknowledged")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
  });

  it("shows a not-found state for a 404, not a retry", async () => {
    mockFetch.mockRejectedValue(
      new ApiError({ code: "not_found", message: "Not found.", status: 404, url: "/notices/x" }),
    );

    renderWithProviders(<PortalNoticeDetail noticeId={NOTICE_ID} />);

    expect(await screen.findByText("Notice not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
