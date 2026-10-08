import {
  approveTransfer,
  completeTransfer,
  fetchStudentTransfers,
  rejectTransfer,
  requestTransfer,
} from "./student-transfers-service";

export const StudentTransfersService = {
  fetchStudentTransfers,
  requestTransfer,
  approveTransfer,
  rejectTransfer,
  completeTransfer,
};
export type {
  CompleteTransferInput,
  RequestInterCampusTransferInput,
  RequestOutgoingTransferInput,
  RequestTransferInput,
  StudentTransferRecord,
} from "./student-transfers-type";
export { formValuesToRequestTransferInput } from "./student-transfers-helper";
export { requestTransferFormSchema } from "./student-transfers.schema";
export type { RequestTransferFormValues } from "./student-transfers.schema";
