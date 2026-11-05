import { screen } from "@testing-library/react";

import { Services } from "@/services";
import { effectiveSlotRecord } from "@/services/modules/timetable-slots/__tests__/timetable-slots-fixtures";
import { AYESHA_ID } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalTimetable } from "../portal-timetable";

jest.mock("next/navigation", () => ({
  useParams: () => ({ studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  // The toolbar heading reads the pathname for its menu item.
  usePathname: () => "/portal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/timetable",
}));

jest.mock("@/services", () => ({
  Services: { timetableSlots: { fetchMyTimetable: jest.fn() } },
}));

const mockFetchMyTimetable = Services.timetableSlots.fetchMyTimetable as jest.MockedFunction<
  typeof Services.timetableSlots.fetchMyTimetable
>;

describe("PortalTimetable", () => {
  it("timetable passes the selected child", async () => {
    mockFetchMyTimetable.mockResolvedValue([effectiveSlotRecord({ subject_name: "Science" })]);

    renderWithProviders(<PortalTimetable />);

    expect(await screen.findByText("Science")).toBeInTheDocument();
    expect(mockFetchMyTimetable).toHaveBeenCalledWith(undefined, AYESHA_ID);
  });
});
