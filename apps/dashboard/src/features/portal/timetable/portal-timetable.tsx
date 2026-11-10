"use client";

import { MyTimetable } from "@/features/timetable/my/my-timetable";
import { ChildGate } from "@/features/portal/shell/child-gate";

/** One child's published week: the staff `MyTimetable`, told which child. */
export function PortalTimetable() {
  return <ChildGate>{(child) => <MyTimetable studentId={child.student.id} />}</ChildGate>;
}
