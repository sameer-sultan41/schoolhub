import { screen } from "@testing-library/react";

import { Services } from "@/services";
import { effectiveSlotRecord } from "@/services/modules/timetable-slots/__tests__/timetable-slots-fixtures";
import { AYESHA_ID, portalDashboard } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalTimetable } from "../portal-timetable";

jest.mock("next/navigation", () => ({
  useParams: () => ({ studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  // The toolbar heading reads the pathname for its menu item.
  usePathname: () => "/portal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/timetable",
}));

jest.mock("@/services", () => ({
  Services: {
    parentPortal: { fetchPortalDashboard: jest.fn() },
    timetableSlots: { fetchMyTimetable: jest.fn() },
  },
}));

const mockFetchDashboard = Services.parentPortal.fetchPortalDashboard as jest.MockedFunction<
  typeof Services.parentPortal.fetchPortalDashboard
>;

const mockFetchMyTimetable = Services.timetableSlots.fetchMyTimetable as jest.MockedFunction<
  typeof Services.timetableSlots.fetchMyTimetable
>;

describe("PortalTimetable", () => {
  it("timetable passes the selected child", async () => {
    mockFetchDashboard.mockResolvedValue(portalDashboard());
    mockFetchMyTimetable.mockResolvedValue([effectiveSlotRecord({ subject_name: "Science" })]);

    renderWithProviders(<PortalTimetable />);

    expect(await screen.findByText("Science")).toBeInTheDocument();
    expect(mockFetchMyTimetable).toHaveBeenCalledWith(undefined, AYESHA_ID);
  });
});
