import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SearchInput } from "../search-input";

function renderSearch(value: string) {
  const onChange = jest.fn();
  render(
    <SearchInput
      value={value}
      onChange={onChange}
      ariaLabel="Search"
      placeholder="Search by name"
      clearLabel="Clear search"
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe("SearchInput", () => {
  it("labels the box and shows the placeholder", () => {
    renderSearch("");

    const box = screen.getByRole("textbox", { name: "Search" });
    expect(box).toHaveAttribute("placeholder", "Search by name");
  });

  it("shows the text it was given", () => {
    renderSearch("Khan");

    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("Khan");
  });

  it("hides the clear button while the box is empty", () => {
    renderSearch("");

    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("shows the clear button once there is text, and clears with onChange('')", async () => {
    const { onChange, user } = renderSearch("Khan");

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("reports what is typed", async () => {
    const { onChange, user } = renderSearch("");

    await user.type(screen.getByRole("textbox", { name: "Search" }), "k");

    expect(onChange).toHaveBeenCalledWith("k");
  });
});
