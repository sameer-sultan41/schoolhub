import {
  createPromotionBatch,
  executeBatch,
  fetchPromotionBatch,
  fetchPromotionBatches,
  transitionBatch,
  updateDecision,
} from "./promotions-service";

export const PromotionsService = {
  fetchPromotionBatches,
  fetchPromotionBatch,
  createPromotionBatch,
  updateDecision,
  transitionBatch,
  executeBatch,
};
export type {
  CreatePromotionBatchInput,
  PromotionAction,
  PromotionBatchCreated,
  PromotionBatchDetail,
  PromotionBatchesQuery,
  PromotionBatchRecord,
  PromotionDecisionRecord,
  PromotionDecisionValue,
  PromotionExecutionReport,
  PromotionProposal,
  PromotionStatus,
  PromotionTransition,
  PromotionTransitionResult,
  UpdateDecisionInput,
} from "./promotions-type";
