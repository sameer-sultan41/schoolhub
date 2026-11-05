"use client";

import { MyTimetable } from "@/features/timetable/my/my-timetable";
import { useSelectedChild } from "@/features/portal/shell/use-selected-child";

/** One child's published week: the staff `MyTimetable`, told which child (the server
 * answers 404 for a student who is not the viewer's own). */
export function PortalTimetable() {
  const { studentId } = useSelectedChild(undefined);
  if (studentId === undefined) return null;
  return <MyTimetable studentId={studentId} />;
}
