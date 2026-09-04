import type { Metadata } from "next";
import { StaffDetail } from "@/features/staff/staff-detail";

// The detail page's metadata can't include the staff member's name: the
// server has no access token (it lives only in the browser's memory), so
// there is no way to fetch the record during generateMetadata. A static
// title is the honest trade-off here, not an oversight — mirrors
// students/[studentId]/page.tsx exactly.
export const metadata: Metadata = { title: "Staff" };

interface StaffPageProps {
  params: Promise<{ staffId: string }>;
}

export default async function StaffMemberPage({ params }: StaffPageProps) {
  const { staffId } = await params;

  return <StaffDetail staffId={staffId} />;
}
