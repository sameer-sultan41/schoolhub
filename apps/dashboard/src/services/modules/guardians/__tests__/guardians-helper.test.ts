import {
  formValuesToCreateGuardianInput,
  formValuesToUpdateGuardianInput,
  toCreateGuardianBody,
  toUpdateGuardianBody,
} from "../guardians-helper";

describe("guardians-helper", () => {
  it("toCreateGuardianBody omits an unset optional entirely", () => {
    const body = toCreateGuardianBody({
      firstName: "Ayesha",
      lastName: "Raza",
      phone: "0300-0000000",
    });

    expect(body).toEqual({ first_name: "Ayesha", last_name: "Raza", phone: "0300-0000000" });
  });

  it("toUpdateGuardianBody sends an explicit null, to clear a field", () => {
    const body = toUpdateGuardianBody({ altPhone: null });

    expect(body).toEqual({ alt_phone: null });
  });

  it("toUpdateGuardianBody omits a field that was never provided at all", () => {
    const body = toUpdateGuardianBody({ phone: "0300-1111111" });

    expect(body).toEqual({ phone: "0300-1111111" });
  });

  it("formValuesToCreateGuardianInput maps the form's snake_case fields to camelCase, omitting empty optionals", () => {
    const input = formValuesToCreateGuardianInput({
      first_name: "Ayesha",
      last_name: "Raza",
      phone: "0300-0000000",
      alt_phone: "",
      email: "",
      photo_file_id: "",
    });

    expect(input).toEqual({ firstName: "Ayesha", lastName: "Raza", phone: "0300-0000000" });
  });

  it("formValuesToUpdateGuardianInput maps an empty form value to an explicit null, not an omitted field or an empty string", () => {
    // The bug this guards: editing a guardian re-sends every field on every save (the form
    // always has a value for each), so "the field is empty" must become `null` (clear the
    // stored value) — sending `""` back would silently turn a stored `null` into `""`
    // every time the form is saved, and omitting the key entirely would (per
    // `toUpdateGuardianBody`'s own `!== undefined` gate) be read as "leave unchanged",
    // which is wrong when the user just cleared the field.
    const input = formValuesToUpdateGuardianInput({
      first_name: "Ayesha",
      last_name: "Raza",
      phone: "0300-0000000",
      alt_phone: "",
      email: "",
      photo_file_id: "",
    });

    expect(input).toEqual({
      firstName: "Ayesha",
      lastName: "Raza",
      phone: "0300-0000000",
      altPhone: null,
      email: null,
    });
  });

  it("formValuesToUpdateGuardianInput keeps a non-empty optional as-is", () => {
    const input = formValuesToUpdateGuardianInput({
      first_name: "Ayesha",
      last_name: "Raza",
      phone: "0300-0000000",
      alt_phone: "0300-1111111",
      email: "ayesha@example.com",
      photo_file_id: "",
    });

    expect(input).toEqual(
      expect.objectContaining({ altPhone: "0300-1111111", email: "ayesha@example.com" }),
    );
  });
});
