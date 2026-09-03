import { render, screen } from "@testing-library/react";
import StudentPage from "./page";

jest.mock("@/features/students/student-detail", () => ({
  StudentDetail: ({ studentId }: { studentId: string }) => (
    <div data-testid="student-detail" data-student-id={studentId} />
  ),
}));

describe("StudentPage", () => {
  it("resolves the studentId param and passes it to the detail view", async () => {
    const ui = await StudentPage({ params: Promise.resolve({ studentId: "s-1" }) });
    render(ui);

    const detail = screen.getByTestId("student-detail");
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveAttribute("data-student-id", "s-1");
  });

  it("sets a static page title via metadata (no access token on the server to fetch the name)", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Student");
  });
});
