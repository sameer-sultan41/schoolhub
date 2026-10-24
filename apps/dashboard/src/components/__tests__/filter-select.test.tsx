import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FilterSelect } from "../filter-select";

const OPTIONS = [
  { id: "class-1", name: "Grade 1" },
  { id: "class-2", name: "Grade 2" },
];

function renderSelect(value: string, disabled = false) {
  const onChange = jest.fn();
  render(
    <FilterSelect
      label="Class"
      allLabel="All classes"
      value={value}
      onChange={onChange}
      options={OPTIONS}
      disabled={disabled}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe("FilterSelect", () => {
  it("is named by its label, and shows the all choice when nothing is picked", () => {
    renderSelect("");

    expect(screen.getByRole("combobox", { name: "Class" })).toHaveTextContent("All classes");
  });

  it("shows the picked option", () => {
    renderSelect("class-2");

    expect(screen.getByRole("combobox", { name: "Class" })).toHaveTextContent("Grade 2");
  });

  it("offers the all choice first, then every option", async () => {
    const { user } = renderSelect("");

    await user.click(screen.getByRole("combobox", { name: "Class" }));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "All classes",
      "Grade 1",
      "Grade 2",
    ]);
  });

  it("reports the picked option's id", async () => {
    const { onChange, user } = renderSelect("");

    await user.click(screen.getByRole("combobox", { name: "Class" }));
    await user.click(await screen.findByRole("option", { name: "Grade 1" }));

    expect(onChange).toHaveBeenCalledWith("class-1");
  });

  it("reports an empty value for the all choice, never the marker", async () => {
    const { onChange, user } = renderSelect("class-1");

    await user.click(screen.getByRole("combobox", { name: "Class" }));
    await user.click(await screen.findByRole("option", { name: "All classes" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("can be disabled", () => {
    renderSelect("", true);

    expect(screen.getByRole("combobox", { name: "Class" })).toBeDisabled();
  });

  it("offers no all choice without allLabel, showing its label until a pick", async () => {
    const user = userEvent.setup();
    render(<FilterSelect label="Section" value="" onChange={jest.fn()} options={OPTIONS} />);

    const trigger = screen.getByRole("combobox", { name: "Section" });
    expect(trigger).toHaveTextContent("Section");
    await user.click(trigger);

    expect(await screen.findAllByRole("option")).toHaveLength(OPTIONS.length);
  });
});
