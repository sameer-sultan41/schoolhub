import { PortalNoticeDetail } from "@/features/portal/notices/portal-notice-detail";

export default async function PortalNoticePage({
  params,
}: {
  params: Promise<{ noticeId: string }>;
}) {
  const { noticeId } = await params;
  return <PortalNoticeDetail noticeId={noticeId} />;
}
