import { ApiError } from "@schoolhub/api-client";
import { screen } from "@testing-library/react";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/features/timetable/timetable-error-alert";
import { renderWithProviders } from "@/test-utils";

describe("ApiErrorAlert", () => {
  it("renders the translated message for a known error code", () => {
    renderWithProviders(
      <ApiErrorAlert
        error={
          new ApiError({
            code: "permission_denied",
            message: "raw server text",
            status: 403,
            url: "/timetable-slots",
          })
        }
      />,
    );

    expect(screen.getByText(/You do not have permission to do that\./)).toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
  });

  it("falls back to the server message for an unknown code and appends the request id", () => {
    renderWithProviders(
      <ApiErrorAlert
        error={
          new ApiError({
            code: "timetable_frozen",
            message: "That session is closed.",
            status: 422,
            url: "/timetable-slots",
            requestId: "req-42",
          })
        }
      />,
    );

    expect(screen.getByText(/That session is closed\./)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-42/)).toBeInTheDocument();
  });

  it("renders nothing for a non-ApiError rejection", () => {
    const { container } = renderWithProviders(<ApiErrorAlert error={new Error("boom")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no error", () => {
    const { container } = renderWithProviders(<ApiErrorAlert error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("unhandledEnvelopeError", () => {
  it("returns null for anything that is not an ApiError", () => {
    expect(unhandledEnvelopeError(new Error("boom"))).toBeNull();
    expect(unhandledEnvelopeError(null)).toBeNull();
  });

  it("returns the error for a non-validation failure", () => {
    const error = new ApiError({
      code: "conflict",
      message: "This slot is published.",
      status: 409,
      url: "/timetable-slots/slot1",
    });

    expect(unhandledEnvelopeError(error)).toBe(error);
  });

  it("returns null when a validation failure named a field the form can show", () => {
    const error = new ApiError({
      code: "domain_rule_violation",
      message: "Invalid.",
      status: 422,
      url: "/timetable-slots",
      details: [{ field: "staff_id", issue: "Only teaching staff can be scheduled." }],
    });

    expect(unhandledEnvelopeError(error)).toBeNull();
  });

  it("returns the error for a 422 that named no field at all", () => {
    // publish_section_timetable's "there is no draft to publish" is exactly this:
    // a 422 whose only detail is `non_field`, which no input can display.
    const error = new ApiError({
      code: "domain_rule_violation",
      message: "There is no draft timetable for this section to publish.",
      status: 422,
      url: "/timetables/sec1:publish",
      details: [{ issue: "There is no draft timetable for this section to publish." }],
    });

    expect(unhandledEnvelopeError(error)).toBe(error);
  });
});
