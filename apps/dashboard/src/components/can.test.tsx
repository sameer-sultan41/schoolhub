import { render, screen } from "@testing-library/react";
import { useAnyPermission, usePermission } from "@/hooks/use-session";
import { Can } from "./can";

jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(),
  useAnyPermission: jest.fn(),
}));

const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;
const mockUseAnyPermission = useAnyPermission as jest.MockedFunction<typeof useAnyPermission>;

describe("Can", () => {
  beforeEach(() => {
    mockUsePermission.mockReset();
    mockUseAnyPermission.mockReset();
  });

  it("renders children when the single permission is held", () => {
    mockUsePermission.mockReturnValue(true);
    mockUseAnyPermission.mockReturnValue(false);

    render(
      <Can permission="fees.invoice.create">
        <button>New invoice</button>
      </Can>,
    );

    expect(screen.getByRole("button", { name: "New invoice" })).toBeInTheDocument();
  });

  it("renders the fallback when the single permission is missing", () => {
    mockUsePermission.mockReturnValue(false);
    mockUseAnyPermission.mockReturnValue(false);

    render(
      <Can permission="fees.invoice.create" fallback={<span>No access</span>}>
        <button>New invoice</button>
      </Can>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("renders nothing by default when denied", () => {
    mockUsePermission.mockReturnValue(false);
    mockUseAnyPermission.mockReturnValue(false);

    const { container } = render(
      <Can permission="fees.invoice.create">
        <button>New invoice</button>
      </Can>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("falls back to the anyOf gate when no single permission is given", () => {
    mockUsePermission.mockReturnValue(false);
    mockUseAnyPermission.mockReturnValue(true);

    render(
      <Can anyOf={["fees.invoice.create", "fees.invoice.view"]}>
        <button>New invoice</button>
      </Can>,
    );

    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("denies by default when neither permission nor anyOf is given", () => {
    mockUsePermission.mockReturnValue(false);
    mockUseAnyPermission.mockReturnValue(false);

    const { container } = render(
      <Can>
        <button>New invoice</button>
      </Can>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
