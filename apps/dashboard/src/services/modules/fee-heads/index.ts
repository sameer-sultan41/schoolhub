import {
  createFeeHead,
  deleteFeeHead,
  fetchFeeHead,
  fetchFeeHeadOptions,
  listFeeHeads,
  updateFeeHead,
} from "./fee-heads-service";

export const FeeHeadsService = {
  listFeeHeads,
  fetchFeeHead,
  fetchFeeHeadOptions,
  createFeeHead,
  updateFeeHead,
  deleteFeeHead,
};
export type { FeeHeadCategory, FeeHeadInput, FeeHeadRecord, FeeHeadsQuery } from "./fee-heads-type";
