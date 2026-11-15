import type { PermissionKey } from "@schoolhub/types";

/** The write keys of a structure resource (`apps/school_organization/permissions.py`). */
export interface StructureKeys {
  create: PermissionKey;
  update: PermissionKey;
  delete: PermissionKey;
}

/** The School module's keys, exactly as `apps/school_organization/permissions.py` registers
 * them (L38). */
export const SCHOOL_SETTINGS_UPDATE: PermissionKey = "school.settings.update";

export const CAMPUS_KEYS: StructureKeys = {
  create: "school.campus.create",
  update: "school.campus.update",
  delete: "school.campus.delete",
};

export const DEPARTMENT_KEYS: StructureKeys = {
  create: "school.department.create",
  update: "school.department.update",
  delete: "school.department.delete",
};

export const HOUSE_KEYS: StructureKeys = {
  create: "school.house.create",
  update: "school.house.update",
  delete: "school.house.delete",
};

/** Any one of a resource's write keys: who a structure section is for. */
export function anyWriteKey(keys: StructureKeys): readonly PermissionKey[] {
  return [keys.create, keys.update, keys.delete];
}
