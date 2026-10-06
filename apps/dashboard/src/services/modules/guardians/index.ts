import {
  createGuardian,
  fetchGuardianById,
  fetchGuardianLinks,
  linkGuardianToStudent,
  searchGuardians,
  updateGuardian,
  updateGuardianLink,
} from "./guardians-service";

export const GuardiansService = {
  searchGuardians,
  fetchGuardianById,
  createGuardian,
  updateGuardian,
  linkGuardianToStudent,
  updateGuardianLink,
  fetchGuardianLinks,
};
export type {
  CreateGuardianInput,
  GuardianLinkRecord,
  GuardianRecord,
  GuardianRelationship,
  LinkGuardianInput,
  UpdateGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-service";
