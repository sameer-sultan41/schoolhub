import { createFine, listFines, updateFine, waiveFine } from "./fines-service";

export const FinesService = { listFines, createFine, updateFine, waiveFine };
export type { FineInput, FineRecord, FinesQuery, FineStatus, FineType } from "./fines-type";
