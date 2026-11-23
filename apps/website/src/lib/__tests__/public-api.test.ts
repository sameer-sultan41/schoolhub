import {
  ADMISSION_ENQUIRY_SUBJECT,
  CONTACT_SUBMISSIONS_PATH,
  HONEYPOT_FIELD,
  submitPublicForm,
} from "../public-api";

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

function lastCall(): { url: string; init: RequestInit; headers: Record<string, string> } {
  const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

// The runtime API_PUBLIC_ORIGIN the server hands the form.
const API_ORIGIN = "https://api.schoolhub.test";

// A fixed per-fill key, as the form would hold it.
const FORM_FILL_ID = "00000000-0000-4000-8000-000000000001";

const SUBMISSION = {
  name: "Ayesha Khan",
  email: "ayesha@example.com",
  message: "Please send me the prospectus.",
  [HONEYPOT_FIELD]: "",
};

describe("submitPublicForm", () => {
  it("posts JSON to the public contact-submissions endpoint", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await expect(
      submitPublicForm(API_ORIGIN, "contact", "cityschool", SUBMISSION, FORM_FILL_ID),
    ).resolves.toBe(true);

    const { url, init, headers } = lastCall();
    expect(CONTACT_SUBMISSIONS_PATH).toBe("/api/v1/public/contact-submissions");
    expect(url).toBe(`${API_ORIGIN}${CONTACT_SUBMISSIONS_PATH}`);
    expect(init.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(SUBMISSION);
  });

  it("names the school and sends the caller's idempotency key", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await submitPublicForm(API_ORIGIN, "contact", "cityschool", SUBMISSION, FORM_FILL_ID);

    const { headers } = lastCall();
    expect(headers["X-Tenant-Slug"]).toBe("cityschool");
    expect(headers["Idempotency-Key"]).toBe(FORM_FILL_ID);
  });

  it("sends the honeypot field so the API can drop bot submissions", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await submitPublicForm(
      API_ORIGIN,
      "contact",
      "cityschool",
      { ...SUBMISSION, [HONEYPOT_FIELD]: "spam" },
      FORM_FILL_ID,
    );

    expect(JSON.parse(lastCall().init.body as string)).toMatchObject({ company_website: "spam" });
  });

  it("posts an admission enquiry as a contact submission with the fixed subject", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await submitPublicForm(
      API_ORIGIN,
      "admission_enquiry",
      "cityschool",
      { ...SUBMISSION, subject: "x" },
      FORM_FILL_ID,
    );

    const { url, init } = lastCall();
    expect(url.endsWith(CONTACT_SUBMISSIONS_PATH)).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({ subject: ADMISSION_ENQUIRY_SUBJECT });
  });

  it("posts to its own origin when the API origin is empty (same-origin proxy)", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await submitPublicForm("", "contact", "cityschool", SUBMISSION, FORM_FILL_ID);

    expect(lastCall().url).toBe(CONTACT_SUBMISSIONS_PATH);
  });

  it("resolves false when the API refuses the submission", async () => {
    mockFetch.mockResolvedValue({ ok: false });
    await expect(
      submitPublicForm(API_ORIGIN, "contact", "cityschool", SUBMISSION, FORM_FILL_ID),
    ).resolves.toBe(false);
  });
});
