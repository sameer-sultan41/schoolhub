import { screen } from "@testing-library/react";

import { Services } from "@/services";
import { cursorPage } from "@/test-fixtures/communication";
import { portalNotice } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalNotices } from "../portal-notices";

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({ notices: ["listNotices"] }),
);

const mockList = Services.notices.listNotices as jest.MockedFunction<
  typeof Services.notices.listNotices
>;

describe("PortalNotices", () => {
  it("lists notices with their type and a flag when acknowledgment is pending", async () => {
    mockList.mockResolvedValue(
      cursorPage([
        portalNotice(),
        portalNotice({
          id: "99999999-9999-4999-8999-999999999999",
          title: "Fee circular",
          notice_type: "circular",
          requires_acknowledgment: false,
        }),
      ]),
    );

    renderWithProviders(<PortalNotices />);

    expect(await screen.findByRole("link", { name: "Sports day" })).toHaveAttribute(
      "href",
      expect.stringContaining("/portal/notices/"),
    );
    expect(screen.getByText("Event")).toBeInTheDocument();
    expect(screen.getByText("Circular")).toBeInTheDocument();
    expect(screen.getAllByText("Acknowledgment needed")).toHaveLength(1);
  });

  it("says so when there are no notices", async () => {
    mockList.mockResolvedValue(cursorPage([]));

    renderWithProviders(<PortalNotices />);

    expect(await screen.findByText("No notices")).toBeInTheDocument();
  });
});
