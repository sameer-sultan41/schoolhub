"use client";

import { useParams } from "next/navigation";

import type { PortalChild } from "@/services";

/** The child the URL's `[studentId]` names, else the first child (the portal home has none).
 * A segment that is not one of the viewer's children, or any segment before `children` has
 * loaded, selects nothing (`studentId` and `child` both `undefined`): no page asks the API
 * about a foreign id, and the nav does not invent a child. */
export function useSelectedChild(children: readonly PortalChild[] | undefined): {
  studentId: string | undefined;
  child: PortalChild | undefined;
} {
  const params = useParams<{ studentId?: string }>();
  const fromUrl = params.studentId;
  const child =
    fromUrl === undefined
      ? children?.[0]
      : children?.find((candidate) => candidate.student.id === fromUrl);
  return { studentId: child?.student.id, child };
}
