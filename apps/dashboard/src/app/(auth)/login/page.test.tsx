import { render, screen } from "@testing-library/react";
import LoginPage from "./page";

jest.mock("@/features/auth/login-form", () => ({
  LoginForm: () => <div>login form</div>,
}));

describe("LoginPage", () => {
  it("renders the login form inside a Suspense boundary", () => {
    render(<LoginPage />);
    expect(screen.getByText("login form")).toBeInTheDocument();
  });
});
