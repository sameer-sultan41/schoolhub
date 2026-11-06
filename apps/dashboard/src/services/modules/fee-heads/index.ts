import {
  createFeeHead,
  deleteFeeHead,
  fetchFeeHead,
  listFeeHeads,
  updateFeeHead,
} from "./fee-heads-service";

export const FeeHeadsService = {
  listFeeHeads,
  fetchFeeHead,
  createFeeHead,
  updateFeeHead,
  deleteFeeHead,
};
export type { FeeHeadCategory, FeeHeadInput, FeeHeadRecord, FeeHeadsQuery } from "./fee-heads-type";
