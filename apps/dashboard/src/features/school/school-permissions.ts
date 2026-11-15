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

export const CLASS_KEYS: StructureKeys = {
  create: "school.class.create",
  update: "school.class.update",
  delete: "school.class.delete",
};

export const SECTION_KEYS: StructureKeys = {
  create: "school.section.create",
  update: "school.section.update",
  delete: "school.section.delete",
};

export const SUBJECT_KEYS: StructureKeys = {
  create: "school.subject.create",
  update: "school.subject.update",
  delete: "school.subject.delete",
};

/** Academic sessions and their terms: terms share the session keys (`TermViewSet`), and a
 * session is never deleted, only closed. Cloning needs `create`. */
export const SESSION_KEYS = {
  create: "school.academic-session.create",
  update: "school.academic-session.update",
  activate: "school.academic-session.activate",
  close: "school.academic-session.close",
} as const satisfies Record<string, PermissionKey>;

/** Any one of a resource's write keys: who a structure section is for. */
export function anyWriteKey(keys: StructureKeys): readonly PermissionKey[] {
  return [keys.create, keys.update, keys.delete];
}
