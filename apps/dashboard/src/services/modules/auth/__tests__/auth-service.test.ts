// Importing the real @/lib/auth builds a real ApiClient at module scope, which binds
// globalThis.fetch — absent in jsdom. Mocking it keeps this test about the re-export
// itself, not about the transport (the same reasoning use-school-day.test.ts documents
// on the main dashboard branch for the equivalent problem).
const mockFetchCurrentUser = jest.fn();

jest.mock("@/lib/auth", () => ({
  fetchCurrentUser: mockFetchCurrentUser,
}));

describe("AuthService", () => {
  it("re-exports @/lib/auth's fetchCurrentUser unchanged, not a wrapped copy", async () => {
    const { fetchCurrentUser } = await import("../auth-service");

    expect(fetchCurrentUser).toBe(mockFetchCurrentUser);
  });
});
