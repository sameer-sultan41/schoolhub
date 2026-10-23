import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/timetable/rooms` — the rooms list with its per-row Edit/Remove buttons, the toolbar's
 * "Add room", and `RoomFormDialog`/`DeleteRoomDialog`. See
 * `apps/dashboard/src/features/timetable/rooms/`.
 */
export class TimetableRoomsPage extends BasePage {
  readonly path = "/timetable/rooms";

  get table(): Locator {
    return this.page.getByRole("table");
  }

  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get addButton(): Locator {
    return this.page.getByRole("button", { name: "Add room", exact: true });
  }

  /** A row's Edit or Remove button, named "{Action} {room}" (`room-columns.tsx`). */
  rowAction(name: string, action: "Edit" | "Remove"): Locator {
    return this.page.getByRole("button", { name: `${action} ${name}`, exact: true });
  }

  /** A list filter, by its trigger's accessible name. Options render in a portal. */
  filter(label: "Campus" | "Room type" | "Status"): Locator {
    return this.page.getByRole("combobox", { name: label, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  get formDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^(Add a room|Edit this room)$/ });
  }

  field(label: "Name" | "Code" | "Capacity" | "Building" | "Floor"): Locator {
    return this.formDialog.getByLabel(label, { exact: true });
  }

  formSelect(label: "Campus" | "Room type"): Locator {
    return this.formDialog.getByRole("combobox", { name: label, exact: true });
  }

  get inServiceSwitch(): Locator {
    return this.formDialog.getByRole("switch", { name: "In service" });
  }

  get saveButton(): Locator {
    return this.formDialog.getByRole("button", { name: "Save", exact: true });
  }

  get removeDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  get confirmRemove(): Locator {
    return this.removeDialog.getByRole("button", { name: "Remove", exact: true });
  }
}
