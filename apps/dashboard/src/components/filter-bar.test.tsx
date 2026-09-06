import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ALL_FILTER_VALUE, FilterBar } from "@/components/filter-bar";
import { renderWithProviders } from "@/test-utils";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

/**
 * A caller, because FilterBar is only half a component on its own: it owns the search
 * draft, the caller owns every committed value. Testing it against real state is what
 * proves the two halves agree — in particular that `onClear` reaching back into the
 * caller's state also empties the box the user typed into.
 */
function Harness({
  onSearchCommit,
  initialStatus = ALL_FILTER_VALUE,
}: {
  onSearchCommit?: (value: string) => void;
  initialStatus?: string;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);

  return (
    <>
      <FilterBar
        search={{
          label: "Search",
          placeholder: "Search by name",
          value: search,
          onChange: (value) => {
            setSearch(value);
            onSearchCommit?.(value);
          },
        }}
        selects={[
          {
            id: "status",
            label: "Status",
            value: status,
            onChange: setStatus,
            options: STATUS_OPTIONS,
            allLabel: "All",
          },
        ]}
        clearLabel="Clear filters"
        onClear={() => {
          setSearch("");
          setStatus(ALL_FILTER_VALUE);
        }}
      />
      <output data-testid="committed">{search}</output>
      <output data-testid="status">{status}</output>
    </>
  );
}

describe("FilterBar", () => {
  it("holds the typed value in the input before the debounce commits it", () => {
    jest.useFakeTimers();
    const onSearchCommit = jest.fn();
    renderWithProviders(<Harness onSearchCommit={onSearchCommit} />);

    const input = screen.getByLabelText("Search");
    fireEvent.change(input, { target: { value: "Am" } });

    expect(input).toHaveValue("Am");
    expect(onSearchCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("committed")).toBeEmptyDOMElement();

    jest.useRealTimers();
  });

  it("commits only the last keystroke once the debounce window elapses", () => {
    jest.useFakeTimers();
    const onSearchCommit = jest.fn();
    renderWithProviders(<Harness onSearchCommit={onSearchCommit} />);

    const input = screen.getByLabelText("Search");
    fireEvent.change(input, { target: { value: "Am" } });
    // A second keystroke inside the window must clear the first pending commit rather
    // than stacking two — only "Amina" should ever reach the caller.
    fireEvent.change(input, { target: { value: "Amina" } });

    act(() => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();

    expect(onSearchCommit).toHaveBeenCalledTimes(1);
    expect(onSearchCommit).toHaveBeenCalledWith("Amina");
    expect(screen.getByTestId("committed")).toHaveTextContent("Amina");
  });

  it("reports a select change straight through, with no debounce", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Suspended" }));

    expect(screen.getByTestId("status")).toHaveTextContent("suspended");
  });

  it("hides the clear control while nothing is filtered", () => {
    renderWithProviders(<Harness />);

    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("shows the clear control as soon as something is typed, before it commits", () => {
    jest.useFakeTimers();
    renderWithProviders(<Harness />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "A" } });

    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("shows the clear control when a select is off its all value", () => {
    renderWithProviders(<Harness initialStatus="active" />);

    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("clearing empties the search box and resets the caller's filters", () => {
    jest.useFakeTimers();
    renderWithProviders(<Harness initialStatus="active" />);

    const input = screen.getByLabelText("Search");
    fireEvent.change(input, { target: { value: "Amina" } });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("committed")).toHaveTextContent("Amina");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(input).toHaveValue("");
    expect(screen.getByTestId("committed")).toBeEmptyDOMElement();
    expect(screen.getByTestId("status")).toHaveTextContent(ALL_FILTER_VALUE);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it("does not fire a pending commit after the filters were cleared", () => {
    jest.useFakeTimers();
    const onSearchCommit = jest.fn();
    renderWithProviders(<Harness onSearchCommit={onSearchCommit} initialStatus="active" />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "Amina" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();

    expect(onSearchCommit).not.toHaveBeenCalled();
  });

  it("adopts a committed value the caller changed out from under it", () => {
    function ExternalReset() {
      const [search, setSearch] = useState("Amina");
      return (
        <>
          <FilterBar
            search={{ label: "Search", value: search, onChange: setSearch }}
            clearLabel="Clear filters"
            onClear={() => {
              setSearch("");
            }}
          />
          <button
            type="button"
            onClick={() => {
              setSearch("Bilal");
            }}
          >
            Reset elsewhere
          </button>
        </>
      );
    }

    renderWithProviders(<ExternalReset />);
    expect(screen.getByLabelText("Search")).toHaveValue("Amina");

    fireEvent.click(screen.getByRole("button", { name: "Reset elsewhere" }));

    expect(screen.getByLabelText("Search")).toHaveValue("Bilal");
  });

  it("renders bespoke controls in the row and treats them as filters when active", () => {
    renderWithProviders(
      <FilterBar
        clearLabel="Clear filters"
        onClear={jest.fn()}
        extrasActive
        selects={[
          {
            id: "status",
            label: "Status",
            value: ALL_FILTER_VALUE,
            onChange: jest.fn(),
            options: STATUS_OPTIONS,
            allLabel: "All",
          },
        ]}
      >
        <input aria-label="From" type="date" readOnly value="2026-01-01" />
      </FilterBar>,
    );

    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("renders no search field at all when the screen has nothing to search", () => {
    renderWithProviders(
      <FilterBar
        clearLabel="Clear filters"
        onClear={jest.fn()}
        selects={[
          {
            id: "status",
            label: "Status",
            value: ALL_FILTER_VALUE,
            onChange: jest.fn(),
            options: STATUS_OPTIONS,
            allLabel: "All",
            className: "w-48",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
  });

  it("honours a caller's own all-value sentinel", () => {
    renderWithProviders(
      <FilterBar
        clearLabel="Clear filters"
        onClear={jest.fn()}
        selects={[
          {
            id: "kind",
            label: "Kind",
            value: "any",
            allValue: "any",
            onChange: jest.fn(),
            options: [{ value: "core", label: "Core" }],
            allLabel: "All",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});
