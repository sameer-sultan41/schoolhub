import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type * as HelpersModule from "@/lib/helpers";
import { downloadFile } from "@/lib/helpers";
import { Services } from "@/services";
import { AYESHA_ID, portalAdmitCard } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalAdmitCards } from "../portal-admit-cards";

jest.mock("@/services", () => ({
  Services: {
    admitCards: { fetchCurrentAdmitCardsPage: jest.fn(), fetchAdmitCardDownloadUrl: jest.fn() },
  },
}));

jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<typeof HelpersModule>("@/lib/helpers"),
  downloadFile: jest.fn(),
}));

const mockFetchCards = Services.admitCards.fetchCurrentAdmitCardsPage as jest.MockedFunction<
  typeof Services.admitCards.fetchCurrentAdmitCardsPage
>;
const mockFetchUrl = Services.admitCards.fetchAdmitCardDownloadUrl as jest.MockedFunction<
  typeof Services.admitCards.fetchAdmitCardDownloadUrl
>;
const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;

const SIGNED_URL = "https://storage.test/admit-card.pdf";
const DOWNLOAD = "Download admit card for Finals";

describe("PortalAdmitCards", () => {
  beforeEach(() => {
    mockFetchCards.mockReset();
    mockFetchUrl.mockReset();
    mockDownloadFile.mockReset();
  });

  it("lists the child's current cards and downloads one through its signed link", async () => {
    mockFetchCards.mockResolvedValue({ items: [portalAdmitCard()] });
    mockFetchUrl.mockResolvedValue(SIGNED_URL);
    const user = userEvent.setup();

    renderWithProviders(<PortalAdmitCards studentId={AYESHA_ID} />);

    await user.click(await screen.findByRole("button", { name: DOWNLOAD }));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(SIGNED_URL, "admit-card-FIN-ADM-001.pdf");
    });
    expect(mockFetchUrl).toHaveBeenCalledWith(portalAdmitCard().id);
    expect(screen.getByText(/Card FIN-ADM-001/)).toBeInTheDocument();
    expect(mockFetchCards).toHaveBeenCalledWith(expect.objectContaining({ studentId: AYESHA_ID }));
  });

  it("says so in place when the download fails", async () => {
    mockFetchCards.mockResolvedValue({ items: [portalAdmitCard()] });
    mockFetchUrl.mockRejectedValue(new Error("gone"));
    const user = userEvent.setup();

    renderWithProviders(<PortalAdmitCards studentId={AYESHA_ID} />);

    await user.click(await screen.findByRole("button", { name: DOWNLOAD }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't download the admit card. Please try again.",
    );
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it("shows an empty state when there is no current card", async () => {
    mockFetchCards.mockResolvedValue({ items: [] });

    renderWithProviders(<PortalAdmitCards studentId={AYESHA_ID} />);

    expect(await screen.findByText("No admit cards")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
  });
});
