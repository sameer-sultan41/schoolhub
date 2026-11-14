import {
  activateFeeStructure,
  archiveFeeStructure,
  createFeeStructure,
  deleteFeeStructure,
  fetchFeeStructure,
  fetchFeeStructureOptions,
  listFeeStructures,
  updateFeeStructure,
} from "./fee-structures-service";

export const FeeStructuresService = {
  listFeeStructures,
  fetchFeeStructure,
  fetchFeeStructureOptions,
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
