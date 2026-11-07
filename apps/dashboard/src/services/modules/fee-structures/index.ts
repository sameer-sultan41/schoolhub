import {
  activateFeeStructure,
  archiveFeeStructure,
  createFeeStructure,
  deleteFeeStructure,
  fetchFeeStructure,
  listFeeStructures,
  updateFeeStructure,
} from "./fee-structures-service";

export const FeeStructuresService = {
  listFeeStructures,
  fetchFeeStructure,
  createFeeStructure,
  updateFeeStructure,
  deleteFeeStructure,
  activateFeeStructure,
  archiveFeeStructure,
};
export type {
  FeeStructureStatus,
  FeeStructureInput,
  FeeStructureRecord,
  FeeStructuresQuery,
} from "./fee-structures-type";
