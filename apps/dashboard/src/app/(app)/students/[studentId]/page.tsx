import type { Metadata } from "next";
import { StudentDetail } from "@/features/students/student-detail";

// The detail page's metadata can't include the student's name: the server has
// no access token (it lives only in the browser's memory), so there is no way
// to fetch the record during generateMetadata. A static title is the honest
// trade-off here, not an oversight.
export const metadata: Metadata = { title: "Student" };

interface StudentPageProps {
  params: Promise<{ studentId: string }>;
}

export default async function StudentPage({ params }: StudentPageProps) {
  const { studentId } = await params;

  return <StudentDetail studentId={studentId} />;
}
