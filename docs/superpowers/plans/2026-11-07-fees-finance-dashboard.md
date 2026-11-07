# Fees & Finance Dashboard: Implementation Plan

> **For agentic workers:**
> - REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> - Per task: one implementer pass. Per PR: one `change-reviewer` pass and one fix pass.
> - **Never run tests, lint or typecheck locally** (ADR-0007). CI is the verifier: push, then read `gh pr checks <n> --watch`.
> - Generators are not checks and must be run when a contract changes: `apps/api/scripts/generate-openapi.sh`, then `pnpm --filter @schoolhub/api-client generate` (L2).
> - Every subagent brief carries the L11 overrides and `docs/07-quality/agent-lessons.md` §2:
>   - never run tests, lint or typecheck locally;
>   - stage only your own files, by path;
>   - never touch `.env*`;
>   - no AI attribution;
>   - never `--no-verify`;
>   - write the report early.
> - Load `schoolhub-dashboard-screen`, `schoolhub-api-services` and `schoolhub-testing`, plus `schoolhub-backend-module` for any backend gap.

**Work tier:** 2

**Goal:** Give `fees-finance` its staff dashboard so a school can run fees from the UI:
- set up its accounts, fee heads and fee structures;
- generate invoices and grant discounts, scholarships and fines;
- collect payments at the counter and print receipts, issue vouchers, settle bank files and handle refunds;
- record expenses and budgets;
- run §13's reports.

Today the backend is complete, and the only fees UI is the parent portal's read-only view.

**Architecture:** five sequential full-stack PRs, each from `main` after the previous one merges (otherwise stacked and retargeted):

| PR | Branch | Ships |
| -- | ------ | ----- |
| A | `feat/fees-dashboard-setup` | Fees shell: sidebar group, sections, landing. Chart of accounts. Fee heads. Fee structures with schedules, activate and archive. Shared money and enum-label helpers promoted to `lib/` |
| B | `feat/fees-dashboard-invoicing` | Invoices list (with the defaulters filter) and detail, cancel. Generate-invoices dialog (202 job). Discounts, scholarships, fines, with revoke and waive |
| C | `feat/fees-dashboard-collection` | Fee counter: find a student, pick an invoice, record a payment, print the receipt. Payments, receipts, vouchers (issue, void, download), refunds queue, settlement imports with exceptions. Backend: the receipt and voucher `format` parameter, a `student` filter on `/receipts`, a `receipt` id on payments, and a typed settlement-import request |
| D | `feat/fees-dashboard-spend` | Expense categories. Expenses with the approval queue (submit, approve, reject, mark paid, reverse). Budgets, approve. Ledger entries with manual journal posting. Backend: read-only `created_by` on expenses |
| E | `feat/fees-dashboard-reports` | Reports hub: the eight `finance-summary` kinds, the on-screen table and the 202 export. The student ledger statement. Backend: typed report and statement responses, plus §13's campus, session and class filters. The module is marked full-stack complete |

PR B also ships one backend change: scholarship status transitions enforced on the server. PR A seeds finance users and data for the live lane.

**Tech stack:**
- Next.js 16 / React 19, TanStack Table 8 and Query 5, react-hook-form + zod, next-intl.
- Jest + RTL; Playwright (the mocked `dashboard` project and the nightly `live` lane).
- Django 6.1 + DRF + drf-spectacular, for the backend gaps listed under each PR.

**Spec:**
- `docs/03-modules/fees-finance.md`: §4 keys, §6 sub-features, §8 journeys, §11 validations, §13 reports, §16 endpoints, §20 status.
- `docs/05-database/entities/finance.md`.
- ADRs: 0005/0017 (generated types), 0011 (services), 0012 (`__tests__`), 0014 (no hardcoding), 0019 (service file shape), 0021 (record-scoped downloads), 0027 (`AnyOf`).
- `docs/deferred-work.md`: the fees "no module screens" entry and the receipts `format` and student-filter entries.
- Templates followed: `docs/superpowers/plans/2026-11-01-examinations-dashboard.md` and `2026-10-24-attendance-dashboard.md`.

**Plan file in the repo:** PR A's first commit adds this plan, with its review block, as `docs/superpowers/plans/2026-11-07-fees-finance-dashboard.md`.

**Workspace:** a worktree, `git worktree add ../schoolhub-fees -b feat/fees-dashboard-setup origin/main` (L21: another session uses the main checkout).

## Context

**What exists on `main`:**

- **Backend** (`apps/api/apps/fees_finance/`): about 19 resources and 25 colon actions. All keys are in `permissions.py`; the flag is `module.fees_finance` (default off).
- **Pagination:** cursor everywhere (`DEFAULT_PAGINATION_CLASS = CursorPagination`).
- **Errors:** business rules are `DomainRuleViolation` (422) with field-keyed details; 409 only when a raw constraint fires.
- **Long-running work is 202 + job:**
  - `fee-invoices:generate` (`fees.generate-invoices`);
  - `voucher-collection-imports` POST (multipart, `fees.import-settlement-file`);
  - `POST reports/finance-summary` (`fees.export-report`).
- **Retry-safe writes take `Idempotency-Key`:**
  - `payments:record` (required);
  - `refunds:create`;
  - `fee-invoices:generate`;
  - the settlement import.
- **Dashboard services that already exist** (read-only, built for the portal):
  - `Services.feeInvoices` (`listFeeInvoices`, `fetchFeeInvoice`);
  - `Services.receipts` (`listReceipts`, `downloadReceipt`);
  - `Services.vouchers` (`listVouchers`, `downloadVoucher`).
  - Their constant and schema files are empty. They are extended, never duplicated.
- **Portal-scoped helpers that staff screens need:**
  - `features/portal/format-decimal.ts` (`formatDecimal`);
  - `features/portal/enum-label.ts` (`enumLabel`, `enumBadge`);
  - `features/portal/fees/fee-status.ts` (`FEE_STATUS_LABEL_KEY`, `FEE_STATUS_BADGE`) and `voucher-labels.ts`.
- **Reusable dashboard parts:**
  - `ModuleSectionNav`, `ModuleLanding`, `sectionMenuItems`, `permittedSections` (`components/module-sections/`);
  - `useDataGridUrlState`, `CursorDataGridCard` with `use-cursor-list`, `usePageClamp`, `LoadErrorCard`;
  - `FormDialogLayout` + `useFormDialogSubmit`, `useConfirmAction` + `ResponsiveAlertDialog`;
  - `useJobPolling`, `useJobFileDownload`, and the report job panel (`features/attendance/reports/report-job-panel.tsx`);
  - `saveBlob` / `apiClient.downloadBlob`, `hasPermission` / `hasAnyPermission` (`lib/permissions.ts`);
  - `menu-config.ts` and `filterMenuByAccess`.
  - `nav.fees` ("Fees & Finance") already exists in both locales.

**What's missing:** every staff route, the sidebar group, write services, an `en`/`ur` `fees` namespace, mocks and page objects, and live specs.

## Screen design

| Section (tab) | Route | Gate key | PR |
| ------------- | ----- | -------- | -- |
| Invoices | `/fees/invoices`, `/fees/invoices/[invoiceId]` | `fees.invoice.view` | B |
| Counter | `/fees/counter` | `fees.payment.collect` | C |
| Payments | `/fees/payments` (sub-tabs: Payments, Receipts, Vouchers, Refunds, Settlement imports) | `fees.payment.view` | C |
| Grants | `/fees/grants` (sub-tabs: Discounts, Scholarships, Fines) | any of `fees.discount.view`, `fees.fine.view` | B |
| Structures | `/fees/structures`, `/fees/structures/[structureId]` (sub-tabs on the list: Structures, Fee heads) | `fees.fee-structure.view` | A |
| Expenses | `/fees/expenses` (sub-tabs: Expenses, Categories, Budgets) | `fees.expense.view` | D |
| Ledger | `/fees/ledger` (sub-tabs: Accounts, Journal) | `fees.ledger.view` | A adds Accounts; D adds Journal |
| Reports | `/fees/reports`, `/fees/students/[studentId]/ledger` | `fees.report.view` (statement: `fees.invoice.view`) | E |

**How the sections work:**
- **Order:** `FEES_SECTIONS` (`features/fees/fees-sections.ts`) fixes the final order. Each PR appends its own entries.
- **Landing:** `/fees` redirects to the first permitted section (`ModuleLanding`).
- **Sidebar:** `{ title: "Fees & Finance", module: "fees", children: sectionMenuItems(FEES_SECTIONS) }`.

**Behaviour shared by every screen:**
- **Lists:** every list is cursor-paged (`CursorDataGridCard`), with filters in the URL (`useDataGridUrlState`).
- **Forms:** create and edit are dialogs. Lifecycle actions are confirm dialogs that keep a server refusal inline. A retry-safe action holds one `Idempotency-Key` per dialog instance, in a ref.
- **Write controls:** hidden without the action's key, and also gated on the record's status (for example, Cancel only on an unpaid invoice that isn't already canceled).
- **Money:** shown with the promoted `formatDecimal` (`tabular-nums`, no currency symbol), as the portal does. Every amount comes from the server; the client never sums.
- **Status:** shown by theme-token badge + icon + label. Labels come from `Record<GeneratedEnum, …>` maps, with the humanised fallback (L32).
- **Fee counter (PR C):**
  1. A student picker: the communication module's `features/communication/messages/student-picker.tsx`, moved to `components/` with its tests (second use, repo-structure §5).
  2. That student's outstanding invoices (`/fee-invoices?student=&outstanding=true`).
  3. The record-payment dialog. Amount defaults to `balance_due`; method excludes `online_gateway`. It POSTs `payments:record` with the dialog's idempotency key.
  4. On success, the receipt prints, using the `receipt` id C1 adds to the payment response (`downloadReceipt(receipt, format)` + `saveBlob`, thermal or PDF as chosen).
- **Idempotency keys:** one per dialog instance, held in a ref, for every replaying write:
  - `payments:record`;
  - `refunds:create`;
  - `refunds/{id}:process`;
  - `ledger-entries:post-journal`;
  - `fee-invoices:generate`;
  - the settlement import.
- **Reads behind other keys (L55):** a screen fetches a part only when the viewer holds that part's own key. For example, the invoice detail reads discounts and fines only for holders of `fees.discount.view` and `fees.fine.view`; `principal` has `fees.invoice.view` but not those.

  A 422 over-balance error shows on `amount`.
- **Generate invoices (PR B):** structure, plus period start or term → 202. Then `useJobPolling` shows the job's created and skipped counts. A re-run with the same structure and period skips (server rule) and says so.
- **Settlement import (PR C):** multipart upload → 202 + polling → an import detail sheet with matched and exception rows.
- **Reports (PR E):**
  - The kind picker plus the filters: date range, student, `group_by`, and E1's campus, session and class.
  - The GET table renders rows typed per kind (E1's `PolymorphicProxySerializer`).
  - A 422 `meta.row_limit` offers Export instead. Export POSTs `reports/finance-summary`, then passes the returned `jobId` to `components/reports/report-job-panel.tsx` (already shared). Formats: csv, xlsx, pdf.
  - **§6's daily collection register per cashier** is the collection report with `group_by=cashier`, plus the payments list's `received_by` filter. §8's "collection dashboard" is the collection report for today, which opens by default.

## Alternatives considered (why not)

| Decision | Chosen | Rejected, and why |
| -------- | ------ | ----------------- |
| PR split | Five PRs by journey: setup → invoicing → collection → spend → reports. Each is reviewable alone, and each journey's prerequisite (structures before invoices, invoices before collection) has already merged | One PR: over 20 screens is too much to review at once. Splitting by resource type ("all lists first"): no PR would deliver a journey a school can use |
| Forms | Dialogs (`FormDialogLayout`), as exams and attendance do | Full pages: no precedent here, and two layouts for one dashboard |
| Fees services | Extend `Services.feeInvoices`, `receipts` and `vouchers`; add new domains (`feeStructures`, `feeHeads`, `ledgerAccounts`, `ledgerEntries`, `discounts`, `scholarships`, `fines`, `payments`, `refunds`, `settlementImports`, `expenses`, `expenseCategories`, `budgets`, `financeReports`), each in the ADR-0019 six-file shape | A single `fees` service file: breaks ADR-0019's one-domain-per-folder shape, and the file would grow past 400 lines |
| Money formatting | Promote `formatDecimal` to `lib/format-decimal.ts`. No currency symbol, the same as the portal | Formatting with `Intl` and `Tenant.currency`: the currency reaches the dashboard only through `school-settings`, a key fees staff don't hold. Deferred: put `currency` on `/auth/me`'s tenant, then add a symbol everywhere at once |
| Enum labels | Promote `enumLabel`/`enumBadge` to `lib/enum-label.ts`, and the portal fee-status maps to `features/fees/shared/`. The portal imports from there (ADR-0012 hoist, recorded in `apps/dashboard/AGENTS.md`) | Copying them for staff: duplicate maps drift (L32) |
| Feature flag | No client flag gating. A tenant with `module.fees_finance` off gets the API's 403 `module_disabled`, which `errors.module_disabled` already explains | Reading `enabled_modules` in the dashboard: no staff module does this today, so it would be a cross-module change |
| Report filters | E1 adds §13's campus, session and class filters, since E1 already touches the endpoint, wherever the kind has a student or invoice dimension (collection, outstanding-aging, grant-register, student-ledger). The ledger-only kinds (trial balance, income vs expense, budget variance, expense register; campus on expenses where the model has it) are left as the model allows | Filtering on the client: wrong over a capped or paged result. Leaving it out: §13 says every report filters this way |
| Scholarship lifecycle | PR B adds a server-side transition table (applied → approved → active → ended or revoked; terminal states final), with tests. `notes` is required for ended and revoked, as today | Gating only in the UI: a PATCH from `revoked` to `active` succeeds today, and hiding a control is not enforcement (Invariant 3) |
| Report and statement responses | E1 adds one row serializer per kind, a `PolymorphicProxySerializer` (ADR-0022, the attendance precedent), `kind` as a `ChoiceField`, and a statement response serializer, with the contract regenerated | Hand-typing rows in the dashboard: violates ADR-0005/0017 |
| Hiding self-approval | D1 exposes `created_by` read-only on expenses so Approve is hidden for the submitter; the server's 422 stays the enforcement | Showing the button and relying on the 422 alone: a button that always fails for the person most likely to see it |
| Refund cap | The request dialog says the cap after the server's 422 (`meta.refundable_remainder`), shown on `amount` | A new read-only field: one more contract change for a value the 422 already gives |
| Ad-hoc invoice | Built in B1: a Create invoice dialog (`POST /fee-invoices`, `fees.invoice.create`) | Leaving it out: §5.2 and §16 list it and the endpoint exists |
| Expense attachment (`receipt_file`, §8) | Deferred: fees has no upload purpose, so the field has no upload or download route (L29) | Shipping the field without them: L29 |
| Structure clone (§6) | Not built | No endpoint exists. Deferred |
| Pay now / online gateway | Not built; `online_gateway` is hidden in the method list | No gateway exists (already deferred) |
| Backend gaps in PR C | The receipt and voucher `format` `OpenApiParameter`; a `student` filter on `/receipts` (which also retires the portal's 2,000-row tenant-wide fetch); a `receipt` id on the payment response; a request serializer for the settlement import (multipart `file` + `provider`) | Leaving the hand-typed `ReceiptFormat` in place: violates ADR-0005. Looking up the receipt with `?payment=`: a second round trip at the counter |

## Global Constraints

- **Verification:** CI only (`api`, `frontend` with Jest at the coverage floor and mocked Playwright, `repo-hygiene`). Dispatch `e2e-live` after each PR and cite the run.
- **Commits:**
  - Conventional Commits, with no `Co-Authored-By` or AI attribution in commits or PRs;
  - `fix` commits carry `Root cause:`;
  - never `--no-verify`.
- **PRs:** commit, push and PR approval are granted for this phase (user, 2026-11-07: "plan and go ahead"). `gh pr create --assignee @me --label "needs review"`, with an ELI5 before the Description. The human merges.
- **Generated contract:** the PR C backend change ships with its regenerated `openapi.yaml` and `schema.d.ts` in one commit. Wire types are `ApiSchemas[...]` aliases only.
- **Dashboard:**
  - **Files:** six-file service modules registered in `Services`, with `services/__tests__/index.test.ts` updated (L7). Query-module and resource constants. Under 400 lines per file. Named constants (ADR-0014).
  - **Components:** `<Input type="date">`; existing pickers (`use-reference-data`); every dialog conditionally mounted.
  - **Pages:** a `<Suspense>` around every `useSearchParams` screen; every `[id]` page checks `isUuid` and calls `notFound()`.
  - **Colors:** theme tokens only (CLAUDE.md), never arbitrary-value colors.
  - **Copy:** one `fees` namespace in both `en` and `ur`, reusing `common.*`/`errors.*`; every enum through an exhaustive `Record` (L32).
- **Mocks** enforce the server's rules (L5). The 422s the UI handles are reproduced in the mock: over-balance, cancel-with-payments, self-approval, activate without schedules.
- **Tests per PR:**
  - Jest beside each screen in `__tests__/`, plus service and helper tests;
  - a mocked spec `e2e/tests/dashboard/fees-<pr>.spec.ts`, with mocks in `e2e/src/mocks/domains/fees.ts` and page objects in `e2e/src/pages/dashboard/fees/`, registered in `pages/index.ts` and `fixtures/index.ts`;
  - a live API spec `e2e/tests/live/api/fees-<pr>.spec.ts` on run-unique data.
  - PR C also adds a live browser journey for the fee counter: record a payment, then a receipt downloads.
- **Docs ship in each PR:**
  - `fees-finance.md` §20 (a "Built (dashboard, PR X)" table);
  - `project-status.md` (fees-finance row and Tier 3);
  - `deferred-work.md` (each deferral above, and remove the fees "no module screens" entry in PR E);
  - `apps/dashboard/AGENTS.md` for each hoist;
  - a lesson for any catch (the next free number is **L59**; main is at L58).
- **Live lane seed:** finance users exist only once A1's seed adds them. Mocked users hold exactly the keys their seeded role holds (L55).
- **No DELETE** for expenses, budgets, discounts, scholarships, fines or invoices: the routes don't exist, so there are no delete service functions for them.
- **Shared code:** a second use of a part means hoisting it in the task that first needs it, together with its tests (ADR-0012).

## Review Focus

1. **A double payment, refund or journal from a double click or a retry.** Each replaying dialog (record payment, refund request, refund process, post journal) holds one `Idempotency-Key` for its lifetime, and its button is disabled while the request is in flight. A retry after a network error reuses the key. Tests: C2, C3 and D2 Jest (two submits → one key); the C live spec (the same key twice → one payment).
2. **An action shown to someone the server will refuse.** Every write button is gated on the key and the record status. Examples: no Approve on your own expense or refund (the server's self-approval 422 is still shown inline), and no Void on a paid voucher. Tests: each PR's Jest permission matrix.
3. **A client-computed total disagrees with the ledger.** No summing in the client: totals, balances and `closing_balance` are the server's values. Tests: B and E Jest assert rendered values equal the fixture's server fields.
4. **A generate re-run looks like a failure.** Skipped invoices are reported as skipped, not as an error. Tests: B1 Jest on a job result that has skips.
5. **A report too large to show.** A 422 `row_limit` offers Export instead of an error card. Tests: E1 Jest.

---

# PR A: Fees shell and setup

### Task A0: Live-lane seed
- **Seed** (`seed_e2e_data`, or a `seed_e2e_fees` command it runs, following `seed_e2e_portal`):
  - `accountant`, `finance_staff` and `school_owner` e2e users, plus a second accountant to act as the other approver;
  - `module.fees_finance` on;
  - a fee head and a draft structure with one schedule.
- **Constants:** the users and data in `e2e/src/lib/seed-constants.ts`.
- **Later PRs extend it:** B adds an active structure, C an issued invoice, D an expense category.
- [ ] Tests: the seed command is idempotent (run twice → same rows).

### Task A1: Hoists, services, shell
- **Hoist:**
  - `formatDecimal` to `lib/format-decimal.ts`, and `enumLabel`/`enumBadge` to `lib/enum-label.ts`. Update the portal imports and move the tests.
  - `FEE_STATUS_*` and the voucher labels to `features/fees/shared/`.
  - Record the hoists in `apps/dashboard/AGENTS.md`.
- **Services:**
  - `ledgerAccounts` (list, fetch, create, update, delete);
  - `feeHeads` (CRUD);
  - `feeStructures` (CRUD, `activate`, `archive`);
  - `feeSchedules` (CRUD).
  - `endpoints.ts` entries and `queryKeys` constants for each.
- **Shell:**
  - `Paths.FEES*`;
  - `features/fees/fees-sections.ts`;
  - `app/(app)/fees/{layout,page}.tsx` (`ModuleSectionNav`, `ModuleLanding`);
  - the sidebar group in `menu-config.ts`;
  - the `fees` namespace in `en`/`ur`.
- [ ] Tests: service tests per function, helper tests, `services/__tests__/index.test.ts`, the landing redirect per permission set.

### Task A2: Ledger accounts, fee heads, fee structures
- **Ledger → Accounts:** a list filtered by type, active and system. Create and edit dialog with a parent picker. Delete is hidden for a system account, and the server's 422 for an account with postings shows inline.
- **Fee heads:** a list and dialog. The income-account picker is filtered to `account_type=income`. The server's in-use refusal on delete shows inline.
- **Fee structures:**
  - A list filtered by session, class, campus and status.
  - A detail page `/fees/structures/[id]` with header actions: Activate (only on a draft, and the 422 for no schedules or a scope conflict shows inline), Archive (only on an active structure), and Edit while editable.
  - An inline Schedules table with a dialog for frequency, due rule and term. Frequency and due-rule errors map to their fields.
- [ ] Jest: the permission matrix, status-gated actions, server 422 shown on the right field.
- [ ] Mocked spec `fees-setup.spec.ts`: create a head → create a structure with a schedule → activate.
- [ ] Live spec `fees-setup.spec.ts`: create → activate → a second active structure in the same scope is 422; another tenant's structure is 404.

### Task A3: Docs, review, PR A
- [ ] Docs per Global Constraints; this plan file in the repo. Then `change-reviewer` with this plan → fix → push → PR → CI → `e2e-live`.

# PR B: Invoicing and grants

### Task B1: Invoices
- **Extend `feeInvoices`:** `create` (ad hoc, `fees.invoice.create`), `generate` (202 with idempotency), `cancel`, and the remaining filters (session, structure, status, period, due range).
- **Create invoice:** a dialog for one student's ad-hoc invoice, with lines.
- **Invoices list:**
  - filters for status, session, structure and student, plus a "Defaulters" toggle (`outstanding=true`);
  - row link to the detail.
- **Invoice detail:** lines, discounts, fines and server totals, then payments, receipts and vouchers (read-only until PR C's actions). Cancel (reason required) is shown only while unpaid.
- **Generate dialog:** structure plus period start or term → 202, then a `useJobPolling` panel with created and skipped counts.
- [ ] Jest: generate success with skips; the cancel 422 for an invoice with payments shown inline; the defaulters filter in the URL.

### Task B2: Discounts, scholarships, fines
- **Grants section with three sub-tabs:**
  - **Discounts:** list and create, and Revoke (`fees.discount.waive`, reason).
  - **Scholarships:** list and create. Status changes go through PATCH `status`, offering only the next legal states (applied → approved → active → ended or revoked). Ending or revoking asks for the required `notes`.
- **Backend (first commit of B2):** a scholarship transition table enforced in the serializer or service. An illegal move is 422 on `status`. Tests: every illegal move is refused (including revoked → active); every legal move succeeds.
  - **Fines:** list and create, and Waive (`fees.fine.waive`, only while pending, reason).
- [ ] Jest: each lifecycle's legal next states; actions hidden without the key.
- [ ] Mocked spec `fees-invoicing.spec.ts`: generate → invoice list → cancel. Grant a discount and waive a fine.
- [ ] Live spec: generate against a seeded active structure → the job completes → invoices are listed; a re-run skips them; another tenant's invoice is 404.

### Task B3: Docs, review, PR B

# PR C: Collection

### Task C1: Backend gaps
- **`format` parameter:** add `OpenApiParameter("format", enum=["pdf","thermal"])` to the receipt and voucher `download` actions.
- **Receipt student filter:** add a `student` filter on `ReceiptFilterSet` through `payment__student`, with a test, a cross-tenant check and a query-count test.
- **Receipt id on payments:** add read-only `receipt` (id) to `PaymentSerializer`, with `select_related`, so the counter downloads the receipt without a second lookup.
- **Refund requester:** if `RefundSerializer` doesn't return who requested the refund, add it read-only, so C3 can hide Approve from the requester (as D1 does for expenses).
- **Settlement import request:** a request serializer (multipart `file` + `provider`) on the import's `create`, replacing `request=None`.
- **Regenerate the contract** in the same commit.
- **Dashboard:** replace the hand-typed `ReceiptFormat`/`VoucherFormat` with the generated enum. The portal's fees page drops its tenant-wide receipt fetch for `?student=` (a deferred-work entry closes).

### Task C2: Fee counter
- **Services:** `payments` (`list`, `record` with a required idempotency key), and `receipts` gains the `student` query.
- **`/fees/counter`:** a student picker → that student's outstanding invoices → a Record payment dialog (amount defaults to `balance_due`; methods are the generated enum minus `online_gateway`) → success shows the receipt with Print PDF and Print thermal.
- [ ] Jest: the over-balance 422 shows on `amount`; two submits send one idempotency key; the receipt download calls `downloadReceipt` + `saveBlob`.

### Task C3: Payments section
- **Sub-tabs:**
  - **Payments:** filters for method, status, date range and cashier.
  - **Receipts:** with download.
  - **Vouchers:** list, Issue (from the invoice detail, `fees.payment.collect`), Void (reason; hidden on a paid voucher), and download.
  - **Refunds:** Request (from a payment; an over-limit amount shows the server's 422 with `meta.refundable_remainder` on `amount`), then Approve, Reject and Process (`fees.refund.approve`). Approve is hidden for the requester (the refund's `requested_by`), and the server's 422 still shows inline.
  - **Settlement imports:** a multipart upload with provider → 202 + polling → a detail sheet with matched and exception rows.
- **Invoice detail (from PR B):** gains Record payment, Issue voucher and Request refund.
- [ ] Jest: refund decision gating; void hidden when paid; settlement import polling to done.
- [ ] Mocked spec `fees-collection.spec.ts`.
- [ ] Live API spec: record a payment twice with one key → one payment; over-balance → 422; refund self-approval → 422.
- [ ] Live journey `fees-counter-journey.spec.ts`: record → receipt PDF downloads.

### Task C4: Docs, review, PR C

# PR D: Spend and journal

### Task D1: Expenses and budgets
- **Backend (first commit):** read-only `created_by` on `ExpenseSerializer`, with the contract regenerated.
- **Services:**
  - `expenseCategories` (list, create, update, delete);
  - `expenses` (list, fetch, create, update, `submit`, `approve`, `reject`, `markPaid`, `reverse`);
  - `budgets` (list, create, update, `approve`).
- **Expenses sub-tab:**
  - an "Awaiting approval" filter (`awaiting_approval=true`) as the approver's queue;
  - actions by status and key: Approve and Reject are hidden for the submitter; Reverse (reason) only on an approved or paid expense.
- **Categories:** the expense-account picker is filtered to `account_type=expense`.
- **Budgets:** Approve only for `fees.budget.approve` and only on a draft budget.

### Task D2: Journal
- **Services:** `ledgerEntries` (list, `postJournal`).
- **Ledger → Journal:** a list filtered by account, date and reference. A Post journal dialog with balanced debit/credit lines. The server checks the balance and the dialog shows its 422; the client shows the running difference only as a hint, never as the gate. `memo` is required.
- [ ] Jest, mocked spec `fees-spend.spec.ts`, and a live spec (submit → self-approve is 422 → another user approves → a ledger entry exists).

### Task D3: Docs, review, PR D

# PR E: Reports and statement

### Task E1: Reports hub
- **Backend (first commit):**
  - one row serializer per kind and a `PolymorphicProxySerializer` on `GET reports/finance-summary` (ADR-0022, after `attendance/views.py`);
  - `kind` as a `ChoiceField` over `REPORT_KINDS`;
  - a response serializer for `GET students/{id}/ledger`;
  - campus, session and class filters on the kinds the Alternatives table names, with tests per filter.
  - Regenerate the contract in the same commit.
- **Service:** `financeReports` (`fetch`, `export` 202).
- **`/fees/reports`:**
  - a kind picker over the eight kinds, with filters per kind (dates, student, `group_by` for collection);
  - a kind-discriminated table;
  - a 422 `row_limit` turns into "Too large to show: export instead";
  - Export (`fees.report.export`, csv/xlsx/pdf): POST → `jobId` → the shared `components/reports/report-job-panel.tsx`.
  - Opens on the collection report for today (§8's collection dashboard); `group_by=cashier` gives §6's per-cashier register.

### Task E2: Student ledger statement
- **`/fees/students/[studentId]/ledger`** (`GET students/{id}/ledger`): rows and the server's `closing_balance`. Linked from the invoice detail and the counter.
- [ ] Jest, mocked spec `fees-reports.spec.ts`, and a live spec (the collection report after PR C's payment contains it; another tenant's student ledger is 404).

### Task E3: Docs, review, PR E
- **Mark complete:** `fees-finance` is full-stack complete in `project-status.md`. Remove the "no module screens" deferred entry. Name the next pickup (communication staff screens).

## Verification

- **Per PR:**
  - CI green (`api` when touched, `frontend`, `repo-hygiene`);
  - `e2e-live` dispatched and cited;
  - every review thread replied to.
- **End to end on the compose stack** (`infra/scripts/seed-dev.sh`, as the seeded accountant):
  1. Create a fee head and a structure with a schedule, then activate it.
  2. Generate invoices for the term; a re-run reports skips.
  3. At the counter, find a student, record a partial payment and print a thermal receipt; the invoice shows `partially_paid`.
  4. Issue a voucher, upload a settlement file, and see it matched.
  5. Request a refund; a second user approves and processes it.
  6. Submit an expense; the owner approves; a journal entry appears.
  7. The collection report shows the day's payment; export it to xlsx.
  8. A guardian portal account still sees only their child's invoice.
- **After code changes:** `graphify update .` in the worktree.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-07
- **Verdict:** REVISE. The journey split and screen design are sound, but the plan:
  - missed three backend gaps: report and statement response schemas, server-side scholarship status rules, and `created_by` on expenses;
  - assumed live-seed users and data that don't exist;
  - rested on wrong premises: the receipt id from a payment, the refund cap, the student-search hook, and idempotency coverage.
- **Findings addressed:**
  1. **Report and statement schemas:** E1's backend commit adds per-kind row serializers, a `PolymorphicProxySerializer`, a `kind` `ChoiceField` and a statement serializer, with the contract regenerated.
  2. **Scholarship transitions:** enforced server-side in B2 (Invariant 3), with tests. Ending or revoking asks for the required `notes`.
  3. **Live seed:** Task A0 adds finance users, a second approver and fee data, extended in B, C and D. Mocked users hold exactly the seeded keys (L55).
  4. **Expense submitter:** D1 exposes `created_by` read-only. C1 does the same for the refund requester if it's missing.
  5. **Refund cap:** taken from the server's 422 `meta.refundable_remainder` and shown on `amount`.
  6. **Counter receipt:** C1 adds a `receipt` id to the payment response.
  7. **Idempotency:** one key per dialog for payments, refund request, refund process, post journal, generate and the settlement import. Added to Review Focus 1 and the tests.
  8. **Student picker:** the existing communication `StudentPicker` is moved to `components/` and reused.
  9. **Reads behind other keys:** each part of a screen is read only by holders of its own key (L55), for example the invoice detail's discounts and fines.
  10. **Uncovered spec items:**
      - ad-hoc invoice: built in B1;
      - expense attachment: deferred (no upload purpose, L29);
      - collection dashboard and cashier register: mapped to the collection report (today, `group_by=cashier`) and the payments list's `received_by`.
  11. **Report export:** uses the shared `components/reports/report-job-panel.tsx`, with the flow written out (422 → POST → `jobId`).
  12. **Settlement import:** C1 adds a request serializer.
  13. **No DELETE:** no delete service functions for resources without a DELETE route.
  14. **Lesson number:** the L59 reason is corrected.
- **Unresolved:** none. Rulings made under the user's "plan and go ahead" (2026-11-07):
  - scholarship transitions are enforced on the server;
  - ad-hoc invoices are in scope;
  - §13's campus, session and class report filters are added in E1;
  - no currency symbol, no client feature-flag gating and the expense attachment are deferred to `deferred-work.md`.
