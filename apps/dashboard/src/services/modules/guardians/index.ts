import {
  createGuardian,
  fetchGuardianById,
  fetchGuardianLinks,
  inviteGuardian,
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
  inviteGuardian,
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
