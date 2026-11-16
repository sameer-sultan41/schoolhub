import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ApiError } from "@schoolhub/api-client";
import { queryKeys } from "@/lib/query-client";
import { renderWithClient } from "@/test-utils";

import { ContentStatusBadge } from "../content-status-badge";
import { PublishActions } from "../publish-actions";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

function actions() {
  return {
    publish: jest.fn().mockResolvedValue({}),
    unpublish: jest.fn().mockResolvedValue({}),
    archive: jest.fn().mockResolvedValue({}),
  };
}

describe("PublishActions", () => {
  it("offers Publish and Archive on a draft, and refreshes the website reads", async () => {
    const user = userEvent.setup();
    const calls = actions();
    const onDone = jest.fn();
    const { queryClient } = renderWithClient(
      <PublishActions status="draft" canPublish onDone={onDone} {...calls} />,
    );
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");

    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(calls.publish).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.module("website") });
    expect(toast.success).toHaveBeenCalledWith("Published.");
  });

  it("offers Unpublish and Archive on a published record", async () => {
    const user = userEvent.setup();
    const calls = actions();
    renderWithClient(<PublishActions status="published" canPublish {...calls} />);

    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(calls.archive).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument();
  });

  it("has no Archive for a record type without one, nor on an archived record", () => {
    const calls = actions();
    const { unmount } = renderWithClient(
      <PublishActions
        status="draft"
        canPublish
        publish={calls.publish}
        unpublish={calls.unpublish}
      />,
    );
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    unmount();

    renderWithClient(<PublishActions status="archived" canPublish {...calls} />);
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("renders nothing without the publish key", () => {
    const { container } = renderWithClient(
      <PublishActions status="draft" canPublish={false} {...actions()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the server's own refusal", async () => {
    const user = userEvent.setup();
    const calls = actions();
    calls.publish.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Invalid.",
        status: 422,
        url: "/website-pages/p1:publish",
        details: [{ field: "non_field", issue: "Add a visible section before publishing." }],
      }),
    );
    renderWithClient(<PublishActions status="draft" canPublish {...calls} />);

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Add a visible section before publishing.");
    });
  });

  it("translates a reasoned refusal keyed to a field it has no input for", async () => {
    const user = userEvent.setup();
    const calls = actions();
    calls.publish.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Invalid.",
        status: 422,
        url: "/website-pages/p1:publish",
        details: [
          {
            field: "sections",
            issue: "no_visible_sections: add at least one visible section before publishing.",
          },
        ],
        meta: { reason: "no_visible_sections" },
      }),
    );
    renderWithClient(<PublishActions status="draft" canPublish {...calls} />);

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Add at least one visible section, and save it, before publishing.",
      );
    });
  });

  it("holds only Publish when told to", () => {
    renderWithClient(<PublishActions status="draft" canPublish publishDisabled {...actions()} />);

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeEnabled();
  });
});

describe("ContentStatusBadge", () => {
  it("labels each status", () => {
    renderWithClient(
      <>
        <ContentStatusBadge status="draft" />
        <ContentStatusBadge status="published" />
        <ContentStatusBadge status="archived" />
      </>,
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });
});
