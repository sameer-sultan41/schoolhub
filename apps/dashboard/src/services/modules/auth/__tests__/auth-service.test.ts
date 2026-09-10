describe("AuthService", () => {
  it("re-exports @/lib/auth's fetchCurrentUser unchanged", async () => {
    const authService = await import("../auth-service");
    const lib = await import("@/lib/auth");

    expect(authService.fetchCurrentUser).toBe(lib.fetchCurrentUser);
  });
});
