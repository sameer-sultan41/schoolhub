import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { Form } from "@schoolhub/ui";

import { renderWithProviders } from "@/test-utils";

import { FormSelectField } from "../form-select-field";

const OPTIONS = [
  { id: "class-1", name: "Grade 1" },
  { id: "class-2", name: "Grade 2" },
];

function TestHost({
  options,
  emptyOption,
}: {
  options: readonly { id: string; name: string }[];
  emptyOption?: { value: string; label: string };
}) {
  const form = useForm<{ classId: string }>({ defaultValues: { classId: "" } });
  return (
    <Form {...form}>
      <FormSelectField
        form={form}
        name="classId"
        label="Class"
        placeholder="Pick a class"
        options={options}
        emptyOption={emptyOption}
      />
    </Form>
  );
}

describe("FormSelectField with nothing to pick", () => {
  it("says there are no options instead of opening a blank box", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TestHost options={[]} />);

    await user.click(screen.getByRole("combobox", { name: "Class" }));

    expect(await screen.findByText("No options available.")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("lists the options, with no empty message, when there are some", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TestHost options={OPTIONS} />);

    await user.click(screen.getByRole("combobox", { name: "Class" }));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Grade 1", "Grade 2"]);
    expect(screen.queryByText("No options available.")).not.toBeInTheDocument();
  });

  it("offers its empty choice rather than the empty message", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TestHost options={[]} emptyOption={{ value: "none", label: "None" }} />);

    await user.click(screen.getByRole("combobox", { name: "Class" }));

    expect(await screen.findByRole("option", { name: "None" })).toBeInTheDocument();
    expect(screen.queryByText("No options available.")).not.toBeInTheDocument();
  });
});
