import { z } from "zod";

import { ApiError, type NavigationTargetType, type NavItem } from "@/services";
import {
  NAV_LABEL_MAX,
  NAV_MAX_DEPTH,
  NAV_PAGE_TARGET,
  NAV_URL_TARGET,
  NAVIGATION_TARGET_TYPES,
} from "@/services/modules/website/navigation-menus/navigation-menus-constant";
import { isSafeUrl } from "@/features/website/shared/schema-model";

/**
 * The menu editor's pure half: a stored menu as form values and back, the moves between its
 * two levels, the client-side checks (the server's own rules, module doc §11), and a 422 keyed
 * by item path made readable.
 */

/** One link. `target` is a page id, a link, or `""` for an index (news, events, gallery). */
export interface NavLinkValues {
  label: string;
  target_type: NavigationTargetType;
  target: string;
}

/** A top-level item and its sub-items (menus nest two levels, `NAV_MAX_DEPTH`). */
export interface NavItemValues extends NavLinkValues {
  children: NavLinkValues[];
}

export interface MenuFormValues {
  items: NavItemValues[];
}

/** Whether a target type carries a target: a page id or a link; the indexes take none. */
export function takesTarget(type: NavigationTargetType): boolean {
  return type === NAV_PAGE_TARGET || type === NAV_URL_TARGET;
}

function toLink(item: Pick<NavItem, "label" | "target_type" | "target">): NavLinkValues {
  return { label: item.label, target_type: item.target_type, target: item.target ?? "" };
}

/** A stored menu as the form's values. */
export function toMenuFormValues(items: readonly NavItem[]): MenuFormValues {
  return {
    items: items.map((item) => ({ ...toLink(item), children: (item.children ?? []).map(toLink) })),
  };
}

function toWireLink(link: NavLinkValues) {
  return {
    label: link.label.trim(),
    target_type: link.target_type,
    target: takesTarget(link.target_type) ? link.target.trim() : null,
  };
}

/** The `PATCH /navigation-menus/{location}` items: trimmed, an index's target as `null`. */
export function toNavItems(values: MenuFormValues): NavItem[] {
  return values.items.map((item) => ({
    ...toWireLink(item),
    children: item.children.map((child) => ({ ...toWireLink(child), children: [] })),
  }));
}

/** Every link in the menu, sub-items included: the count `NAV_MAX_ITEMS` caps. */
export function countLinks(items: readonly NavItemValues[]): number {
  return items.reduce((total, item) => total + 1 + item.children.length, 0);
}

/** A top-level item may move under the one above it only if it holds no sub-items of its own:
 * with them, the menu would nest deeper than `NAV_MAX_DEPTH`. */
export function canNest(items: readonly NavItemValues[], index: number): boolean {
  const item = items[index];
  if (index < 1 || item === undefined) return false;
  const depthAfter = 1 + (item.children.length > 0 ? 2 : 1);
  return depthAfter <= NAV_MAX_DEPTH;
}

/** `items` with the one at `index` moved to the end of the item above's sub-items. */
export function nestItem(items: readonly NavItemValues[], index: number): NavItemValues[] {
  const item = items[index];
  const parent = items[index - 1];
  if (!canNest(items, index) || item === undefined || parent === undefined) return [...items];
  const next = [...items];
  next[index - 1] = { ...parent, children: [...parent.children, toLink(item)] };
  next.splice(index, 1);
  return next;
}

/** `items` with sub-item `childIndex` of item `parentIndex` moved out, just after its parent. */
export function unnestItem(
  items: readonly NavItemValues[],
  parentIndex: number,
  childIndex: number,
): NavItemValues[] {
  const parent = items[parentIndex];
  const child = parent?.children[childIndex];
  if (parent === undefined || child === undefined) return [...items];
  const next = [...items];
  next[parentIndex] = {
    ...parent,
    children: parent.children.filter((_child, index) => index !== childIndex),
  };
  next.splice(parentIndex + 1, 0, { ...child, children: [] });
  return next;
}

export interface MenuMessages {
  required: string;
  tooLong: (max: number) => string;
  unsafeUrl: string;
  choosePage: string;
}

/** A link's target check: a page link needs a page, a URL link a safe link (decision 5a). */
function checkTarget(
  link: Pick<NavLinkValues, "target_type" | "target">,
  messages: MenuMessages,
  report: (message: string) => void,
) {
  const target = link.target.trim();
  if (link.target_type === NAV_PAGE_TARGET && target === "") report(messages.choosePage);
  else if (link.target_type === NAV_URL_TARGET && !isSafeUrl(target)) {
    report(target === "" ? messages.required : messages.unsafeUrl);
  }
}

function linkShape(messages: MenuMessages) {
  return {
    label: z
      .string()
      .trim()
      .min(1, messages.required)
      .max(NAV_LABEL_MAX, messages.tooLong(NAV_LABEL_MAX)),
    target_type: z.enum(
      NAVIGATION_TARGET_TYPES as [NavigationTargetType, ...NavigationTargetType[]],
    ),
    target: z.string(),
  };
}

/** The checks the server makes that the form can make first. Depth and the item count are held
 * by the editor's own controls (and refused by the server, should they ever get through). */
export function menuFormSchema(messages: MenuMessages) {
  const child = z.object(linkShape(messages)).superRefine((link, ctx) => {
    checkTarget(link, messages, (message) => {
      ctx.addIssue({ code: "custom", path: ["target"], message });
    });
  });
  const item = z
    .object({ ...linkShape(messages), children: z.array(child) })
    .superRefine((link, ctx) => {
      checkTarget(link, messages, (message) => {
        ctx.addIssue({ code: "custom", path: ["target"], message });
      });
    });
  return z.object({ items: z.array(item) });
}

/** The inputs a server error can name, for the menu on screen. */
export function menuFields(values: MenuFormValues): string[] {
  return values.items.flatMap((item, index) => [
    `items.${index}.label`,
    `items.${index}.target`,
    ...item.children.flatMap((_child, childIndex) => [
      `items.${index}.children.${childIndex}.label`,
      `items.${index}.children.${childIndex}.target`,
    ]),
  ]);
}

const TARGET_FIELD = /^items\.(\d+)(?:\.children\.(\d+))?\.target$/;
const REASON_PREFIX = /^([a-z][a-z_]*): /;

/** The link a server error's field names, if it names one. */
function linkAt(values: MenuFormValues, field: string): NavLinkValues | undefined {
  const match = TARGET_FIELD.exec(field);
  if (!match) return undefined;
  const item = values.items[Number(match[1])];
  return match[2] === undefined ? item : item?.children[Number(match[2])];
}

/**
 * The server's `invalid_target` covers three cases (a page that is not published, an unsafe
 * link, a target on an index); which one is read from the link it names, so the message is
 * specific and in the viewer's language. `messageFor` gets the reason and that link's type
 * (`undefined` when no link fits) and returns the text, or `undefined` to keep the server's.
 */
export function localiseMenuError(
  error: unknown,
  values: MenuFormValues,
  messageFor: (reason: string, targetType: NavigationTargetType | undefined) => string | undefined,
): unknown {
  if (!(error instanceof ApiError)) return error;
  return new ApiError({
    code: error.code,
    message: error.message,
    status: error.status,
    url: error.url,
    details: error.details.map((detail) => {
      const reason = REASON_PREFIX.exec(detail.issue)?.[1];
      if (reason === undefined) return detail;
      const link = detail.field === undefined ? undefined : linkAt(values, detail.field);
      const issue = messageFor(reason, link?.target_type);
      return issue === undefined ? detail : { ...detail, issue };
    }),
    requestId: error.requestId,
    meta: error.meta,
  });
}
