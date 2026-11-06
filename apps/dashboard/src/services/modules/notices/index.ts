import { listNotices, fetchNotice, acknowledgeNotice } from "./notices-service";

export const NoticesService = {
  listNotices,
  fetchNotice,
  acknowledgeNotice,
};
export type {
  NoticeRead,
  NoticeRecord,
  NoticesQuery,
  NoticeType,
  PortalNoticeRecord,
} from "./notices-type";
