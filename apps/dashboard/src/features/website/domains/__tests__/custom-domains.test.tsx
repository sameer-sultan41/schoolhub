import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";
import { toast } from "sonner";

import { ApiError, Services, type CustomDomainRecord } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { STAMP, violation } from "@/features/website/shared/__tests__/content-fixtures";
import { CustomDomains } from "../custom-domains";

// The screen renders the shell toolbar, which reads the path (`usePathname`).
jest.mock("next/navigation", () =>
  jest
    .requireActual<{ createNavigationMock: () => unknown }>("@/test-utils")
    .createNavigationMock(),
);

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ domainsServicesMock: () => unknown }>("./domains-services-mock")
    .domainsServicesMock(),
);

const fetchDomains = mocked(Services.customDomains.fetchCustomDomains);
const createDomain = mocked(Services.customDomains.createCustomDomain);
const verifyDomain = mocked(Services.customDomains.verifyCustomDomain);
const setPrimary = mocked(Services.customDomains.setPrimaryCustomDomain);
const deleteDomain = mocked(Services.customDomains.deleteCustomDomain);

const DOMAIN = "www.greenfield.edu.pk";

/** A domain as `GET /custom-domains` sends it: the TXT to remove later, the CNAME to keep. */
function domainRecord(overrides: Partial<CustomDomainRecord> = {}): CustomDomainRecord {
  const domain = overrides.domain ?? DOMAIN;
  return {
    id: "5d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b",
    domain,
    status: "pending_dns",
    tls_status: "pending",
    is_primary: false,
    verified_at: null,
    last_error: "",
    last_error_code: null,
    dns_records: [
      {
        type: "TXT",
        name: `_schoolhub-verify.${domain}`,
        value: "token-abc123",
        keep_after_verification: false,
      },
      { type: "CNAME", name: domain, value: "sites.schoolhub.test", keep_after_verification: true },
    ],
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** `school_owner`'s keys (`website_cms/permissions.py`: `DOMAIN_ADMINS`). */
const OWNER_KEYS: PermissionKey[] = [
  "website.custom-domain.create",
  "website.custom-domain.update",
  "website.custom-domain.delete",
];

async function renderScreen(keys: PermissionKey[] = OWNER_KEYS) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(keys));
  renderWithProviders(
    <>
      <UserLoaded />
      <CustomDomains />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

function card(domain = DOMAIN) {
  return within(screen.getByRole("region", { name: domain }));
}

/** The domains as the server holds them: a write changes what the next GET reads. */
let current: CustomDomainRecord[];

function serve(...domains: CustomDomainRecord[]) {
  current = domains;
}

/** The server's answer to a write: it stores `saved`, so the refetch after it agrees. */
function answer(saved: CustomDomainRecord): Promise<CustomDomainRecord> {
  current = current.map((row) => (row.id === saved.id ? saved : row));
  return Promise.resolve(saved);
}

beforeEach(() => {
  jest.clearAllMocks();
  setUrl("/website/domains");
  serve(domainRecord());
  fetchDomains.mockImplementation(() => Promise.resolve(current));
});

describe("custom domains: instructions", () => {
  it("shows each record with its keep-or-remove note, and copies a value", async () => {
    const user = await renderScreen();
    await screen.findByRole("heading", { name: DOMAIN });

    expect(card().getByText("Waiting for DNS")).toBeInTheDocument();
    expect(card().getByText("HTTPS pending")).toBeInTheDocument();
    const txt = within(card().getByRole("listitem", { name: "TXT record" }));
    const cname = within(card().getByRole("listitem", { name: "CNAME record" }));
    expect(txt.getByText(`_schoolhub-verify.${DOMAIN}`)).toBeInTheDocument();
    expect(txt.getByText(/You can remove this record once the domain is verified/)).toBeVisible();
    expect(cname.getByText(/Keep this record/)).toBeVisible();
    expect(cname.getByText(/isn't followed/)).toBeVisible();

    await user.click(txt.getByRole("button", { name: "Copy the TXT record's value" }));

    await expect(navigator.clipboard.readText()).resolves.toBe("token-abc123");
    expect(toast.success).toHaveBeenCalledWith("Copied.");
  });

  it("says to copy by hand when the browser refuses the clipboard", async () => {
    const user = await renderScreen();
    await screen.findByRole("heading", { name: DOMAIN });
    jest.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));

    await user.click(card().getByRole("button", { name: "Copy the CNAME record's value" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't copy. Select the text and copy it instead.",
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says when there are no domains yet", async () => {
    serve();
    await renderScreen();

    expect(await screen.findByText("No custom domains yet")).toBeInTheDocument();
  });
});

describe("custom domains: verify", () => {
  it("shows what a failed check found, in the viewer's words", async () => {
    verifyDomain.mockImplementation(() =>
      answer(
        domainRecord({
          status: "failed",
          last_error_code: "txt_missing",
          last_error: "TXT missing.",
        }),
      ),
    );
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Check DNS" }));

    expect(await card().findByText("Failed")).toBeInTheDocument();
    expect(card().getByText(/The TXT record wasn't found/)).toBeInTheDocument();
    expect(verifyDomain).toHaveBeenCalledWith(domainRecord().id);
    expect(toast.error).toHaveBeenCalledWith(`${DOMAIN} didn't pass the DNS check.`);
  });

  it("keeps the status on an inconclusive lookup and says so", async () => {
    verifyDomain.mockImplementation(() =>
      answer(domainRecord({ last_error_code: "lookup_timeout" })),
    );
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Check DNS" }));

    expect(await card().findByText(/The DNS check timed out/)).toBeInTheDocument();
    expect(card().getByText("Waiting for DNS")).toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalled();
  });

  it("shows a 409 domain_taken on the card once, though the claim also stores it", async () => {
    const issue = "domain_taken: this domain is in use by another school.";
    verifyDomain.mockImplementation(() => {
      // The server stores the claim `failed` with the code before it answers 409.
      serve(domainRecord({ status: "failed", last_error_code: "domain_taken", last_error: issue }));
      return Promise.reject(
        new ApiError({
          code: "conflict",
          message: issue,
          status: 409,
          url: "/api/v1/custom-domains",
          details: [{ field: "domain", issue }],
          meta: { reason: "domain_taken" },
        }),
      );
    });
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Check DNS" }));

    expect(await card().findByText("Failed")).toBeInTheDocument();
    // `getByText` throws on two matches: the refusal and the stored code read as one message.
    expect(card().getByText("Another school already uses this domain.")).toBeInTheDocument();
  });

  it("holds every action while a check is running", async () => {
    let finish: (saved: CustomDomainRecord) => void = () => undefined;
    verifyDomain.mockImplementation(
      () =>
        new Promise<CustomDomainRecord>((resolve) => {
          finish = resolve;
        }),
    );
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Check DNS" }));

    expect(card().getByRole("button", { name: /Check DNS/ })).toBeDisabled();
    expect(card().getByRole("button", { name: "Remove" })).toBeDisabled();
    finish(domainRecord({ last_error_code: "lookup_timeout" }));
    await waitFor(() => {
      expect(card().getByRole("button", { name: "Check DNS" })).toBeEnabled();
    });
  });

  it("offers no check on an active domain", async () => {
    serve(domainRecord({ status: "active", verified_at: STAMP }));
    await renderScreen();
    await screen.findByRole("heading", { name: DOMAIN });

    expect(card().queryByRole("button", { name: "Check DNS" })).not.toBeInTheDocument();
  });
});

describe("custom domains: primary", () => {
  it("holds Make primary with the reason until the domain is active", async () => {
    await renderScreen();
    const button = await screen.findByRole("button", { name: "Make primary" });

    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Can be made primary once the domain is verified.");
  });

  it("holds Make primary while HTTPS isn't issued, even when active", async () => {
    serve(domainRecord({ status: "active", tls_status: "pending" }));
    await renderScreen();
    const button = await screen.findByRole("button", { name: "Make primary" });

    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "Can be made primary once its HTTPS certificate is issued.",
    );
  });

  it("makes an active domain with HTTPS issued the primary, and shows a refusal translated", async () => {
    serve(domainRecord({ status: "active", tls_status: "issued" }));
    setPrimary.mockRejectedValueOnce(
      violation(
        "is_primary",
        "tls_not_issued",
        "the domain's HTTPS certificate is not issued yet.",
      ),
    );
    setPrimary.mockImplementationOnce(() =>
      answer(domainRecord({ status: "active", tls_status: "issued", is_primary: true })),
    );
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Make primary" }));
    expect(
      await card().findByText(/HTTPS certificate isn't issued yet, so it can't be the primary/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Make primary" }));

    expect(await card().findByText("Primary")).toBeInTheDocument();
    expect(setPrimary).toHaveBeenLastCalledWith(domainRecord().id, true);
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument();
  });
});

describe("custom domains: add and remove", () => {
  it("needs a domain, shows the server's refusal under it, then the records to add", async () => {
    const added = domainRecord({ domain: "greenfield.school" });
    createDomain.mockRejectedValueOnce(
      violation("domain", "invalid_domain", "enter a domain name such as www.example.org."),
    );
    createDomain.mockResolvedValueOnce(added);
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Add domain" }));
    let dialog = screen.getByRole("dialog", { name: "Add a custom domain" });
    await user.click(within(dialog).getByRole("button", { name: "Add domain" }));
    expect(await within(dialog).findByText("Enter a domain.")).toBeInTheDocument();
    expect(createDomain).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Domain"), "  not a domain ");
    await user.click(within(dialog).getByRole("button", { name: "Add domain" }));
    expect(
      await within(dialog).findByText("Enter a domain name such as www.yourschool.edu.pk."),
    ).toBeInTheDocument();
    expect(createDomain).toHaveBeenCalledWith({ domain: "not a domain" });

    await user.clear(within(dialog).getByLabelText("Domain"));
    await user.type(within(dialog).getByLabelText("Domain"), "greenfield.school");
    await user.click(within(dialog).getByRole("button", { name: "Add domain" }));

    dialog = await screen.findByRole("dialog", { name: "Set up greenfield.school" });
    expect(within(dialog).getByRole("listitem", { name: "TXT record" })).toBeInTheDocument();
    expect(within(dialog).getByRole("listitem", { name: "CNAME record" })).toBeInTheDocument();
  });

  it("holds Add at the limit, with the reason", async () => {
    serve(
      ...["a", "b", "c", "d", "e"].map((label, index) =>
        domainRecord({
          id: `00000000-0000-4000-8000-00000000000${index}`,
          domain: `${label}.edu.pk`,
        }),
      ),
    );
    await renderScreen();
    await screen.findByRole("heading", { name: "a.edu.pk" });

    const add = screen.getByRole("button", { name: "Add domain" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(
      "A school can add up to 5 domains. Remove one to add another.",
    );
  });

  it("removes a domain only once confirmed", async () => {
    deleteDomain.mockImplementation(() => {
      serve();
      return Promise.resolve();
    });
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog", { name: `Remove ${DOMAIN}?` });
    expect(deleteDomain).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(deleteDomain).toHaveBeenCalledWith(domainRecord().id);
    });
    expect(toast.success).toHaveBeenCalledWith(`${DOMAIN} removed.`);
  });

  it("shows only the actions the viewer's keys allow", async () => {
    await renderScreen(["website.custom-domain.update"]);
    await screen.findByRole("heading", { name: DOMAIN });

    expect(screen.queryByRole("button", { name: "Add domain" })).not.toBeInTheDocument();
    expect(card().queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(card().getByRole("button", { name: "Check DNS" })).toBeInTheDocument();
  });
});
