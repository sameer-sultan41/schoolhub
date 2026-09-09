# Dashboard Route Migration: Metronic Demo1 → `(app)/dashboard` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the throwaway `/dev/metronic-demo1` Metronic Demo1 preview into the real `/dashboard` route, with every file under the route using the `@/*` path alias instead of `../../../`-style relative imports.

**Architecture:** Pure file-move + import-rewrite. `_metronic/` (55 support/chrome/widget files) moves from `app/dev/metronic-demo1/_metronic` to `app/(app)/_metronic`, matching this app's documented convention that authenticated screens live under `src/app/(app)/…` (`apps/dashboard/AGENTS.md`). The route entry files (`layout.tsx`, `page.tsx`, `metronic-extras.css`) move to `app/(app)/layout.tsx` and `app/(app)/dashboard/page.tsx`. Every relative import inside the moved tree is rewritten to the `@/*` alias via a one-off codemod script (55 files / 115 relative-import occurrences — too many to hand-edit reliably). No component logic, styling, or content changes. No auth/permission wiring, no schoolhub data substitution — that's explicitly out of scope for this pass.

**Tech Stack:** Next.js 16 App Router, TypeScript, existing `@/*` → `./src/*` path alias already configured in `apps/dashboard/tsconfig.json`.

**Spec:** the earlier Plan Mode session that built the original `/dev/metronic-demo1` preview this plan migrates.

## Global Constraints

- Path alias `@/*` maps to `apps/dashboard/src/*` (`apps/dashboard/tsconfig.json`) — every import rewritten by this plan must resolve through it.
- Authenticated routes live under `src/app/(app)/…`; a module screen is `src/app/(app)/<module>/page.tsx` (`apps/dashboard/AGENTS.md`).
- Never run test suites, typechecks, or linters locally — commit, and verify structurally via the dev server + curl/browser, not `pnpm build`/`tsc` (root `CLAUDE.md`).
- Do not touch `packages/ui` or `apps/website`.
- No schoolhub-specific data, nav, or branding substituted into the Metronic content in this pass — it stays Metronic's own sample content; only file locations and import paths change.
- Commits end without a Co-Authored-By trailer per this session's active attribution instruction; use the exact trailer given in that instruction instead.

---

### Task 0: Checkpoint the verified preview baseline

Nothing from the Metronic Demo1 build (already browser-verified working) is committed yet — it's all working-tree state. Commit it as-is first, so the move in Tasks 1–2 has a clean baseline to diff against and revert to if anything breaks.

**Files:** everything currently modified/untracked under `apps/dashboard/` (package.json, globals.css, layout.tsx, i18n/request.ts, the untracked `src/app/dev/` tree, the untracked `public/media/` assets).

- [ ] **Step 1: Review what's staged**

```bash
git status --porcelain=v1 -- apps/dashboard
```

Expected: the modified files (`package.json`, `globals.css`, `layout.tsx`, `i18n/request.ts`) plus `?? apps/dashboard/src/app/dev/` and `?? apps/dashboard/public/media/`. No unrelated files.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/src/app/globals.css apps/dashboard/src/app/layout.tsx apps/dashboard/src/i18n/request.ts apps/dashboard/src/app/dev apps/dashboard/public/media
git commit -m "feat(dashboard): add live Metronic Demo1 preview at /dev/metronic-demo1

Whole, real Metronic Demo1 template rendered with Metronic's own sample
data — throwaway reference preview, gated to development only. Baseline
for the /dashboard route migration in the next commits."
```

(No Co-Authored-By trailer — see this session's active attribution instruction for the exact trailer to append instead.)

---

### Task 1: Move `_metronic/` under `(app)/` and alias-ify its imports

**Files:**
- Move: `apps/dashboard/src/app/dev/metronic-demo1/_metronic/**` → `apps/dashboard/src/app/(app)/_metronic/**` (55 files)
- Create (throwaway, scratchpad only, not committed): a codemod script

**Interfaces:**
- Produces: every file under `apps/dashboard/src/app/(app)/_metronic/**` exporting the same symbols as before, at the same relative structure, just alias-addressed as `@/app/(app)/_metronic/...` from anywhere else in the app.

- [ ] **Step 1: Move the directory**

```bash
mkdir -p "apps/dashboard/src/app/(app)"
mv "apps/dashboard/src/app/dev/metronic-demo1/_metronic" "apps/dashboard/src/app/(app)/_metronic"
```

- [ ] **Step 2: Write the import-rewrite codemod**

Create `/private/tmp/claude-501/-Users-avialdo-Documents-schoolhub/*/scratchpad/alias-ify.mjs` (scratchpad — not part of the repo):

```js
import fs from "node:fs";
import path from "node:path";

const SRC_ROOT = "/Users/avialdo/Documents/schoolhub/apps/dashboard/src";
const TARGET_DIR = path.join(SRC_ROOT, "app/(app)/_metronic");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Matches `from "./x"`, `from '../x'`, and `import("./x")` specifiers only
// (relative — starts with "./" or "../"); leaves package imports untouched.
const IMPORT_RE = /(from\s+["']|import\(\s*["'])(\.\.?\/[^"']+)(["'])/g;

let filesChanged = 0;
let importsChanged = 0;

for (const file of walk(TARGET_DIR)) {
  const dir = path.dirname(file);
  const text = fs.readFileSync(file, "utf8");
  let fileChanged = false;

  const next = text.replace(IMPORT_RE, (match, prefix, spec, suffix) => {
    const abs = path.resolve(dir, spec);
    const rel = path.relative(SRC_ROOT, abs).split(path.sep).join("/");
    fileChanged = true;
    importsChanged++;
    return `${prefix}@/${rel}${suffix}`;
  });

  if (fileChanged) {
    fs.writeFileSync(file, next);
    filesChanged++;
  }
}

console.log(`files changed: ${filesChanged}, imports rewritten: ${importsChanged}`);
```

- [ ] **Step 3: Run it**

```bash
node /private/tmp/claude-501/-Users-avialdo-Documents-schoolhub/*/scratchpad/alias-ify.mjs
```

Expected: `files changed: <N>, imports rewritten: 115` (some files import multiple relative specifiers, so `filesChanged` will be less than 115 but should cover the great majority of the 55 moved files).

- [ ] **Step 4: Verify no relative imports remain**

```bash
grep -rn 'from "\.\.\?/\|import(\s*"\.\.\?/' "apps/dashboard/src/app/(app)/_metronic"
```

Expected: no output (empty grep = zero matches).

- [ ] **Step 5: Spot-check one rewritten file**

```bash
grep -n "^import" "apps/dashboard/src/app/(app)/_metronic/dashboard/channel-stats.tsx"
```

Expected: `import { toAbsoluteUrl } from "@/app/(app)/_metronic/helpers";` (was `from "../helpers"`).

- [ ] **Step 6: Delete the throwaway codemod script**

```bash
rm -f /private/tmp/claude-501/-Users-avialdo-Documents-schoolhub/*/scratchpad/alias-ify.mjs
```

- [ ] **Step 7: Commit**

```bash
git add "apps/dashboard/src/app/(app)/_metronic"
git status --porcelain=v1 -- apps/dashboard/src/app/dev  # confirm old _metronic subtree is gone from there
git commit -m "refactor(dashboard): move Metronic _metronic tree under (app)/, alias-ify imports

Matches this app's convention that authenticated screens live under
src/app/(app)/... and replaces the ../../../ relative-import chains
with @/* alias imports throughout."
```

---

### Task 2: Move the route entry files to `(app)/dashboard`, drop the dev-only gate, verify live

**Files:**
- Move: `apps/dashboard/src/app/dev/metronic-demo1/layout.tsx` → `apps/dashboard/src/app/(app)/layout.tsx`
- Move: `apps/dashboard/src/app/dev/metronic-demo1/metronic-extras.css` → `apps/dashboard/src/app/(app)/metronic-extras.css`
- Move: `apps/dashboard/src/app/dev/metronic-demo1/page.tsx` → `apps/dashboard/src/app/(app)/dashboard/page.tsx`
- Delete: now-empty `apps/dashboard/src/app/dev/` tree

**Interfaces:**
- Consumes: `@/app/(app)/_metronic/shell` (`Shell`), `@/app/(app)/_metronic/settings-provider` (`SettingsProvider`), `@/app/(app)/_metronic/dashboard/dashboard-page-content` (`DashboardPageContent`) — all produced by Task 1.

- [ ] **Step 1: Move the files**

```bash
mkdir -p "apps/dashboard/src/app/(app)/dashboard"
mv "apps/dashboard/src/app/dev/metronic-demo1/layout.tsx" "apps/dashboard/src/app/(app)/layout.tsx"
mv "apps/dashboard/src/app/dev/metronic-demo1/metronic-extras.css" "apps/dashboard/src/app/(app)/metronic-extras.css"
mv "apps/dashboard/src/app/dev/metronic-demo1/page.tsx" "apps/dashboard/src/app/(app)/dashboard/page.tsx"
find "apps/dashboard/src/app/dev" -type d -empty -delete
```

Expected after: `apps/dashboard/src/app/dev` no longer exists (both its files were the only contents).

- [ ] **Step 2: Rewrite `(app)/layout.tsx`**

```tsx
import type { ReactNode } from "react";

import { Shell } from "@/app/(app)/_metronic/shell";
import { SettingsProvider } from "@/app/(app)/_metronic/settings-provider";

import "@/app/(app)/metronic-extras.css";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <Shell>{children}</Shell>
    </SettingsProvider>
  );
}
```

- [ ] **Step 3: Rewrite `(app)/dashboard/page.tsx`**

Drop the `NODE_ENV === "production"` gate — this is now the real route, not a dev-only preview.

```tsx
import { DashboardPageContent } from "@/app/(app)/_metronic/dashboard/dashboard-page-content";

// No auth guard yet (apps/dashboard/src/proxy.ts doesn't exist) — this route
// is reachable unauthenticated until that's rebuilt (apps/dashboard/AGENTS.md).
export default function DashboardPage() {
  return <DashboardPageContent />;
}
```

- [ ] **Step 4: Fix `(app)/metronic-extras.css`'s self-reference**

The file moved from two levels under `app/` (`dev/metronic-demo1/`) to one level under it (`(app)/`), so its `@reference` to the app's `globals.css` needs one fewer `../`. This one stays a relative path deliberately — Tailwind's `@reference` directive resolves through the CSS build pipeline, not the webpack/tsconfig `@/*` alias, so it can't be aliased the same way as the TS/TSX imports.

Change line 1 from `@reference "../../globals.css";` to `@reference "../globals.css";`. Leave everything else in the file (the `@import "@schoolhub/ui/styles/metronic/..."` lines) untouched — those already resolve through package-name (npm workspace) resolution, not relative paths.

- [ ] **Step 5: Start the dev server and verify the route**

```bash
source ~/.nvm/nvm.sh && nvm use 24
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
pnpm --filter @schoolhub/dashboard dev &
timeout 30 bash -c 'until curl -sf http://localhost:3000/dashboard >/dev/null; do sleep 1; done'
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dev/metronic-demo1
```

Expected: first curl `200`, second curl `404` (old route is gone).

- [ ] **Step 6: Browser-driven visual check**

Reuse the same headless-Chromium approach as the original preview verification (a throwaway Playwright script placed under `e2e/` so Node's ESM resolution finds `@playwright/test`, not under scratchpad): navigate to `http://localhost:3000/dashboard`, screenshot full page, check `document.images` for anything not `.complete`/`naturalWidth === 0`, and check for console errors. Confirm header/sidebar/footer/6 widgets render identically to the prior preview (same components, only the URL and import paths changed). Delete the script afterward.

- [ ] **Step 7: Commit**

```bash
git add "apps/dashboard/src/app/(app)/layout.tsx" "apps/dashboard/src/app/(app)/metronic-extras.css" "apps/dashboard/src/app/(app)/dashboard/page.tsx"
git status --porcelain=v1 -- apps/dashboard/src/app/dev  # confirm dev/ is fully gone
git commit -m "feat(dashboard): promote Metronic Demo1 preview to the real /dashboard route

Moves the route from the throwaway /dev/metronic-demo1 gate to
(app)/dashboard, matching this app's authenticated-route convention.
Drops the NODE_ENV production gate since this is no longer a dev-only
preview."
```

## Verification

1. `curl http://localhost:3000/dashboard` → 200; `curl http://localhost:3000/dev/metronic-demo1` → 404.
2. `grep -rn 'from "\.\.\?/' "apps/dashboard/src/app/(app)"` → empty (aside from the one intentional CSS `@reference` line, which isn't matched by this TS-import grep anyway).
3. Browser check: header, sidebar nav, footer, toolbar, breadcrumb, and all 6 dashboard widgets render exactly as they did at `/dev/metronic-demo1`, no broken images, no console errors.
4. `git status --porcelain=v1 -- apps/website packages/ui` → empty (still untouched).
5. Do not run `pnpm build`/`tsc`/lint locally — leave TypeScript verification (aliasing mistakes, moved-file resolution) to CI once this is pushed.
