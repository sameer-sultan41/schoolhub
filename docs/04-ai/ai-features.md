# AI Feature Catalog

> **Agent Context**
> **Summary:** The authoritative registry of every AI feature in the platform, keyed by feature ID (`AI-<MODULE>-<nn>`). Each entry defines the owning module, execution pattern (per [`../02-architecture/ai-architecture.md`](../02-architecture/ai-architecture.md) §3), inputs, measurable value, human-approval requirement, and delivery wave. Module docs' §14 sections reference these IDs; policy (privacy, approval rules, budgets) lives in [`ai-governance.md`](ai-governance.md). All AI features ship in Phase 3 ([`../01-phases/phase-3-ai.md`](../01-phases/phase-3-ai.md)), flagged per tenant and plan.
> **Co-load with:** [`ai-governance.md`](ai-governance.md) · [`../02-architecture/ai-architecture.md`](../02-architecture/ai-architecture.md) · [`../01-phases/phase-3-ai.md`](../01-phases/phase-3-ai.md)

## 1. How to Read This Catalog

- **ID** — the registry key. Format `AI-<MODULE PREFIX>-<nn>`; prefixes match module docs (SCH, STU, STF, ATT, ACA, TTB, EXM, FEE, HRL, ADM, PAR, COM, LIB, TRN, INV, CRT, WEB, RPT, PLA) plus **GEN** for cross-cutting features owned by the AI gateway itself. IDs coined in module docs are reproduced here with their original meaning; this file is the single place an ID's semantics are normative.
- **Pattern** — one of the four execution patterns in [`ai-architecture.md`](../02-architecture/ai-architecture.md) §3: **Sync ask** (streamed, ≤30 s), **Draft** (draft-for-approval on the owning module's entity), **Batch** (nightly Celery analytics writing scored suggestions), **Intake** (async OCR/extraction + human verification screen).
- **Approval** — whether a human must approve before the output reaches a record, student, parent, or the public, and who. "No" always means *advisory/read-only* — no AI feature ever acts autonomously (see [`ai-governance.md`](ai-governance.md) §3).
- **Wave** — build order per [`../01-phases/phase-3-ai.md`](../01-phases/phase-3-ai.md) §2: **1** admin/staff drafting & NL access, **2** teacher tooling, **3** student/parent assistants, **4** risk analytics. Wave assignments for features beyond the phase doc's named examples follow the same risk ordering (recommendation).
- Every request executes with the **initiating user's RBAC + RLS context** ([`../02-architecture/auth-and-rbac.md`](../02-architecture/auth-and-rbac.md) §3); no feature can surface data its caller couldn't open in the UI.

## 2. Platform & School Administrators

Features used by platform staff, school owners/admins, principals, and office roles (accountants, HR, store keepers, transport managers, librarians in their administrative capacity). Heavily weighted toward wave-1 drafting/NL access and wave-4 advisory analytics; nothing in this section acts on a record without a permitted human confirming.

| ID | Feature | Module | Pattern | What it does (Inputs) | Measurable value | Approval | Wave |
| -- | ------- | ------ | ------- | --------------------- | ---------------- | -------- | ---- |
| `AI-GEN-01` | AI school assistant / admin chatbot *(not yet referenced by a module doc)* | Cross-cutting (AI gateway) | Sync ask | Conversational assistant for administrators and staff across enabled modules — answers operational questions, explains workflows, navigates to the right screen; whitelisted read tools only. (Inputs: RBAC-scoped module data via tool registry, product help content) | Reduced admin time-to-answer; fewer support tickets per tenant | No — read-only; any drafting handed off to the owning feature's gate | 1 |
| `AI-SCH-01` | Setup copilot | [School organization](../03-modules/school-organization.md) | Draft | Turns a plain-language school description into a reviewable draft of campuses/sessions/classes/sections/subjects. (Inputs: admin's description, tenant plan limits, seed templates) | Setup time cut from days to hours | Yes — admin approves before any record is created | 1 |
| `AI-SCH-02` | Natural-language structure search | [School organization](../03-modules/school-organization.md) | Sync ask | Conversational queries over school configuration ("sections in North Campus over 90% capacity"). (Inputs: academic-structure tables, caller scope) | Faster configuration audits | No — read-only, logged | 1 |
| `AI-SCH-03` | Structure recommendations | [School organization](../03-modules/school-organization.md) | Batch | Flags unbalanced section sizes, missing curriculum coverage, calendar/exam conflicts. (Inputs: structure, calendar, enrollment counts) | Fewer mid-session restructures | No — advisory, no auto-apply | 4 |
| `AI-PLA-01` | AI-assisted migration mapping *(recommendation)* | [Platform admin](../03-modules/platform-admin.md) | Intake | Proposes column-to-field mappings and cleanup transforms from a legacy-file sample. (Inputs: uploaded file sample, target schema) | Migration setup hours per school reduced | Yes — human confirms mapping before any dry run | 1 |
| `AI-PLA-02` | Churn & health insights *(recommendation)* | [Platform admin](../03-modules/platform-admin.md) | Batch | Flags tenants with declining usage or quota/dunning stress for outreach. (Inputs: aggregate usage metrics only — never row-level school data) | Improved tenant retention | No — advisory to platform staff | 4 |
| `AI-PLA-03` | Onboarding assistant *(recommendation)* | [Platform admin](../03-modules/platform-admin.md) | Draft | Conversational helper in the wizard turning a school description into draft academic structure. (Inputs: admin's description, wizard state) | Higher wizard completion rate | Yes — admin reviews draft structure | 1 |
| `AI-ADM-01` | Admission lead scoring | [Admissions](../03-modules/admissions.md) | Batch | Conversion-likelihood score per lead, refreshed on each interaction, with visible score factors; never auto-rejects. (Inputs: source, engagement history, campaign, historical cohorts) | Higher lead-to-enrollment conversion; focused follow-up | No — advisory prioritization only | 4 |
| `AI-ADM-02` | AI admission assistant | [Admissions](../03-modules/admissions.md) | Sync ask | Applicant-facing assistant (campaign FAQs, requirements, tokenized status) scoped to published content; staff-facing drafting and application-file summaries. (Inputs: published campaign content; application record for staff) | Fewer front-office enquiries; faster interview prep | Partial — public Q&A unmoderated but scope-locked; staff drafts sent only by staff | 3 |
| `AI-ADM-03` | OCR / document extraction | [Admissions](../03-modules/admissions.md) | Intake | Extracts fields from uploaded documents into `application_documents.extracted_data`, diffed against form data. (Inputs: uploaded document images/PDFs) | Data-entry minutes saved per application | Yes — verification remains a human action | 1 |
| `AI-ADM-04` | Enrollment demand forecasting *(recommendation)* | [Admissions](../03-modules/admissions.md) | Batch | Per-class applicant demand and seat-fill projection from funnel velocity. (Inputs: funnel stage history, seats, prior sessions) | Better seat planning | No — advisory | 4 |
| `AI-COM-01` | Automated parent communication suggestions | [Communication](../03-modules/communication.md) | Draft | Proposes targeted messages from cross-module signals (attendance dips, overdue fees, upcoming exams); never auto-sends. (Inputs: attendance, fee, exam signals) | Higher parent-contact coverage with less staff effort | Yes — staff review, edit, approve every suggestion | 3 |
| `AI-COM-02` | AI-generated announcements & notices | [Communication](../03-modules/communication.md) | Draft | Drafts announcements/notices from a short prompt in tenant tone and locale(s). (Inputs: prompt, tenant branding/locales, templates) | Drafting time per circular reduced | Yes — mandatory human edit/approval; publish gates unchanged | 1 |
| `AI-COM-03` | Tone, translation & emergency drafting assistant | [Communication](../03-modules/communication.md) | Draft | Rewrites for clarity/formality, produces locale variants, offers pre-structured emergency drafts. (Inputs: draft text, tenant locales) | Multilingual reach without translators | Yes — sender approves; emergency confirmation step never bypassed | 1 |
| `AI-FEE-01` | Fee/payment prediction | [Fees & finance](../03-modules/fees-finance.md) | Batch | Per-student late/default likelihood with a prioritized follow-up list on the accountant dashboard. (Inputs: payment history, invoice size, engagement signals) | Improved on-time collection rate | No for the score; Yes — staff approve any resulting communication | 4 |
| `AI-FEE-02` | NL finance queries & report summaries | [Fees & finance](../03-modules/fees-finance.md) | Sync ask | "Collection this term vs last, by campus" answered from report data; narrative summaries on scheduled reports. (Inputs: finance report data, caller scope) | Finance questions answered without report-builder training | No — read-only | 1 |
| `AI-FEE-03` | Smart reminder suggestions | [Fees & finance](../03-modules/fees-finance.md) | Draft | Recommended reminder timing/wording per guardian (ties into `AI-COM-01`). (Inputs: guardian payment behavior, channel preferences) | Fewer overdue invoices per reminder sent | Yes — staff approve before sending | 3 |
| `AI-FEE-04` | Payroll & expense anomaly detection *(recommendation)* | [Fees & finance](../03-modules/fees-finance.md) | Batch | Flags outlier payslip deltas and unusual expense patterns during review. (Inputs: payroll runs, expense records) | Error/fraud caught pre-payment | No — advisory flags to the reviewer | 4 |
| `AI-HRL-01` | Staff attendance & leave anomaly detection | [HR & leave](../03-modules/hr-leave.md) | Batch | Flags recurring patterns (Monday/Friday sick leave, pre-holiday clusters, outlier lateness). (Inputs: staff attendance and leave history) | Earlier HR intervention | No — advisory for HR review | 4 |
| `AI-HRL-02` | Absence forecasting & coverage risk | [HR & leave](../03-modules/hr-leave.md) | Batch | Predicts high-absence days; warns approvers when an approval drops department coverage below threshold. (Inputs: leave history, academic calendar) | Fewer uncovered classes | No — advisory; human still approves leave | 4 |
| `AI-HRL-03` | AI-generated HR report summaries | [HR & leave](../03-modules/hr-leave.md) | Sync ask | Plain-language summaries of leave utilization and exception reports. (Inputs: HR report data) | Leadership reporting time reduced | No — labeled read-only output | 1 |
| `AI-INV-01` | Reorder & demand prediction | [Inventory & assets](../03-modules/inventory-assets.md) | Batch | Forecasts consumable demand (e.g. exam-season paper spikes) and proposes reorder quantities. (Inputs: movement history, academic calendar) | Fewer stockouts and rush orders | Yes — `store_keeper` confirms every PO | 4 |
| `AI-INV-02` | Document extraction for procurement | [Inventory & assets](../03-modules/inventory-assets.md) | Intake | OCR of supplier invoices/quotes into PO/receiving fields. (Inputs: uploaded invoices/quotes) | Procurement data-entry time cut | Yes — all extracted values reviewed before save | 1 |
| `AI-INV-03` | Asset anomaly insights | [Inventory & assets](../03-modules/inventory-assets.md) | Batch | Flags outlier maintenance cost/frequency; suggests repair-vs-replace. (Inputs: maintenance and cost history) | Lower total maintenance spend | No — advisory only | 4 |
| `AI-TRN-01` | Route optimization suggestions | [Transport](../03-modules/transport.md) | Batch | Proposes stop ordering/route splits. (Inputs: stop coordinates, student counts, time windows) | Shorter routes, better bus utilization | Yes — `transport_manager` applies changes manually | 4 |
| `AI-TRN-02` | Predictive maintenance | [Transport](../03-modules/transport.md) | Batch | Flags anomalous maintenance patterns and predicts next-failure windows. (Inputs: service history, odometer trends) | Fewer in-service breakdowns | No — advisory, never auto-schedules | 4 |
| `AI-TRN-03` | Transport Q&A for staff | [Transport](../03-modules/transport.md) | Sync ask | NL queries over own-scope transport data ("routes over 90% full?"). (Inputs: routes, stops, assignments in caller scope) | Transport questions self-served | No — read-only | 1 |
| `AI-TTB-01` | Smart timetable generation | [Timetable](../03-modules/timetable.md) | Draft (async job) | Proposes a full conflict-free timetable draft. (Inputs: class subjects, teacher allocations, availability constraints, room inventory) | Timetable prep cut from days to hours | Yes — admin edits and publishes; publish blocked on hard conflicts | 4 |
| `AI-TTB-02` | Conflict resolution suggestions | [Timetable](../03-modules/timetable.md) | Sync ask | When the **deterministic conflict engine** (timetable §7 — the module's validator, not AI) reports conflicts, suggests minimal swap sequences to resolve them. (Inputs: conflict list, current draft slots) | Conflict-fix time per draft reduced | Yes — admin applies each swap | 4 |
| `AI-TTB-03` | Substitute recommendation | [Timetable](../03-modules/timetable.md) | Sync ask | Ranks substitute candidates (deterministic ranking augmented by model constraint reasoning). (Inputs: qualifications, familiarity, load, historical acceptance) | Faster same-day coverage | Yes — approver assigns the substitute | 4 |
| `AI-TTB-04` | Schedule quality insights | [Timetable](../03-modules/timetable.md) | Batch | Flags pedagogically poor patterns (heavy subjects stacked late, uneven distribution) on drafts. (Inputs: draft timetable) | Better-balanced published timetables | No — advisory notes on drafts | 4 |
| `AI-STF-01` | Teacher performance insights | [Staff management](../03-modules/staff-management.md) | Batch | Narrative insights for review preparation; visible only to holders of `staff.performance-review.create`; excluded from automated decisions. (Inputs: allocation load, attendance regularity, class results, parent-communication signals) | Better-prepared, fairer reviews | No — advisory; review decisions remain human | 4 |
| `AI-STF-02` | Document & credential extraction (OCR) | [Staff management](../03-modules/staff-management.md) | Intake | Extracts fields from uploaded degrees/IDs to pre-fill qualification records. (Inputs: uploaded credential documents) | Staff onboarding data-entry reduced | Yes — human confirms every value before save | 1 |
| `AI-STF-03` | Natural-language staff search | [Staff management](../03-modules/staff-management.md) | Sync ask | "Science teachers at North Campus with M.Sc. under 20 weekly periods." (Inputs: staff records in caller scope) | Faster staffing decisions | No — read-only | 1 |
| `AI-STF-04` | Workload balance recommendations | [Staff management](../03-modules/staff-management.md) | Batch | Flags over/under-allocated teachers ahead of allocation season. (Inputs: academics/timetable allocation data) | More even teaching loads | No — advisory only | 4 |
| `AI-CRT-01` | AI document summarization | [Certificates & documents](../03-modules/certificates-documents.md) | Sync ask | Summarizes uploaded student/staff documents into profile-ready abstracts stored as draft annotations; never replaces the source file. (Inputs: uploaded document content) | Record-review time per file cut | Yes — staff accept the draft annotation | 1 |
| `AI-CRT-02` | AI template drafting assistant *(recommendation)* | [Certificates & documents](../03-modules/certificates-documents.md) | Draft | Drafts certificate/letter wording with valid merge-field placeholders. (Inputs: prompt, merge-field schema) | Template authoring time reduced | Yes — admin reviews, saves as draft template version | 1 |
| `AI-CRT-03` | OCR / document extraction (legacy certificates) | [Certificates & documents](../03-modules/certificates-documents.md) | Intake | Extracts structured fields from scanned legacy certificates during migration. (Inputs: scanned certificates) | Migration accuracy and speed | Yes — extracted values flagged for human confirmation | 1 |
| `AI-WEB-01` | AI-generated website content | [Website CMS](../03-modules/website-cms.md) | Draft | Generates/rewrites section copy, about pages, principal messages, news posts in tenant tone and locale. (Inputs: bullet points/prompt, tenant branding) | Website content produced without copywriters | Yes — editor publish gate; nothing goes live unpublished | 1 |
| `AI-WEB-02` | AI SEO assistant *(recommendation)* | [Website CMS](../03-modules/website-cms.md) | Draft | Drafts meta titles/descriptions and OG text; flags missing/duplicate SEO fields. (Inputs: page content) | Improved search visibility | Yes — editor reviews before publish | 1 |
| `AI-WEB-03` | Image alt-text generation *(recommendation)* | [Website CMS](../03-modules/website-cms.md) | Draft | Proposes accessible alt text for gallery and section images. (Inputs: images) | Accessibility compliance coverage | Yes — editor reviews before publish | 1 |
| `AI-RPT-01` | Natural-language dashboard queries | [Reporting & analytics](../03-modules/reporting-analytics.md) | Sync ask | Plain-language questions mapped to whitelisted report definitions, executed under caller permissions; response includes the resolved report key and filters. (Inputs: NL query, report catalog) | Staff self-serve analytics without report-builder training | No — read-only; every query and resolved definition logged | 1 |
| `AI-RPT-02` | AI-generated report narratives | [Reporting & analytics](../03-modules/reporting-analytics.md) | Sync ask | Plain-language summary of findings/trends attached to any report output or scheduled delivery; clearly labeled AI-generated. (Inputs: report result data) | Reports understood without an analyst | No — labeled read-only output | 1 |
| `AI-RPT-03` | Predictive & anomaly insights *(recommendation)* | [Reporting & analytics](../03-modules/reporting-analytics.md) | Batch | Dashboard callouts for anomalies and simple forecasts; domain-specific predictions stay owned by their modules and are surfaced here. (Inputs: report time series) | Issues seen days earlier | No — advisory, links to underlying report | 4 |
| `AI-ATT-01` | Attendance anomaly detection | [Attendance](../03-modules/attendance.md) | Batch | Flags unusual patterns (weekday/period-clustered absences, sudden drops, section outliers) for class teacher/principal review. (Inputs: attendance records) | Absence problems caught weeks earlier | No — advisory flags | 4 |
| `AI-STU-01` | At-risk student detection | [Student management](../03-modules/student-management.md) | Batch | Combines attendance, results, and fee signals to flag students needing intervention, with reason codes on admin/principal dashboards. (Inputs: attendance, results, fee signals) | Earlier interventions; measurable via flagged-student outcome tracking | No — advisory only; interventions are human decisions | 4 |
| `AI-STU-02` | Dropout-risk indicators | [Student management](../03-modules/student-management.md) | Batch | Longitudinal risk scoring across sessions (attendance decay, performance decline, fee stress); visible to `principal`/`school_admin` only; never shown to students/guardians. (Inputs: multi-session attendance/results/fee history) | Reduced dropout rate at pilot schools | No — advisory; strictly staff-facing | 4 |
| `AI-EXM-04` | Result anomaly screening | [Examinations](../03-modules/examinations.md) | Batch | Pre-approval screen for entry errors (impossible jumps, uniform values, outlier sections) shown to the result approver. (Inputs: entered marks vs history) | Fewer published-result corrections | No — advisory flags; principal still approves results | 4 |

## 3. Teachers

Features in the daily teaching workflow: planning, question authoring, marking, and class-level insight. Every artifact that could reach a student passes the teacher's explicit approval; grading suggestions never post marks.

| ID | Feature | Module | Pattern | What it does (Inputs) | Measurable value | Approval | Wave |
| -- | ------- | ------ | ------- | --------------------- | ---------------- | -------- | ---- |
| `AI-GEN-02` | AI teacher assistant *(not yet referenced by a module doc)* | Cross-cutting (AI gateway) | Sync ask | Conversational assistant for teachers over their assigned classes: answers questions, launches drafting flows (lesson plans → `AI-ACA-01`, questions → `AI-EXM-01`), summarizes class status. (Inputs: `assigned`-scoped class/attendance/results data via tool registry) | Teacher admin time per week reduced | No for Q&A; all drafts inherit the owning feature's approval gate | 2 |
| `AI-ACA-01` | Lesson & term-plan generation | [Academics](../03-modules/academics.md) | Draft | Drafts lesson plans and term topic sequences; also seeds **assignment and quiz drafts** (quiz/question delivery lives in examinations, `AI-EXM-*`). (Inputs: class-subject curriculum, session calendar, grading scheme) | Lesson-planning hours per week cut | Yes — teacher edits/approves every artifact | 2 |
| `AI-ACA-02` | Promotion recommendations | [Academics](../03-modules/academics.md) | Batch | Explains each auto-proposed promotion decision and flags borderline students with reasoning for the review meeting; never auto-approves. (Inputs: results, attendance, trend) | Faster, better-documented promotion meetings | Yes — promotion decisions made only in the human review | 4 |
| `AI-ACA-03` | Teacher allocation recommendations | [Academics](../03-modules/academics.md) | Draft | Proposes an allocation plan optimizing qualification match, load balance, continuity; presented as a per-row applicable diff. (Inputs: qualifications, loads, prior-year allocations) | Allocation season shortened | Yes — `vice_principal` applies per row | 4 |
| `AI-ACA-04` | Academic performance insights | [Academics](../03-modules/academics.md) | Sync ask | NL Q&A and narrative insights over class/subject performance ("which Grade 7 subjects declined vs. last term?"). (Inputs: results data in caller scope) | Data-driven teaching adjustments without analyst support | No — read-only, permission-scoped | 1 |
| `AI-EXM-01` | Exam-question & question-bank generation | [Examinations](../03-modules/examinations.md) | Draft | Drafts questions (MCQ, short/long answer) by subject, class level, topic, difficulty for question banks, papers, and quizzes. (Inputs: subject/class/topic/difficulty blueprint, existing bank) | Paper-setting time cut; larger question banks | Yes — each question individually approved (`exams.question.approve`) before entering a bank | 2 |
| `AI-EXM-02` | AI grading assistance | [Examinations](../03-modules/examinations.md) | Draft | Suggests scores and feedback for short/long-answer responses; AI never writes to `marks` directly. (Inputs: student responses supplied by the teacher, rubric) | Marking time per script reduced | Yes — teacher confirms or adjusts every suggestion | 2 |
| `AI-EXM-03` | Student performance analysis | [Examinations](../03-modules/examinations.md) | Batch | Per-student and per-section insight summaries after publishing (strengths, declining subjects, prior-exam comparison); feeds the shared at-risk indicator (`AI-ATT-02`). (Inputs: published results history) | Targeted remediation per student | No — advisory insights | 4 |
| `AI-ATT-03` | Parent communication suggestions (absence follow-up) | [Attendance](../03-modules/attendance.md) | Draft | Drafts absence follow-up messages for guardians. (Inputs: absence records, guardian contact preferences) | Follow-up coverage of absences increased | Yes — staff member must approve/edit before sending (mandatory) | 3 |
| `AI-ATT-04` | Natural-language attendance queries | [Attendance](../03-modules/attendance.md) | Sync ask | "Which Grade 6 students were absent more than 3 days this month?" (Inputs: attendance records in caller scope) | Attendance questions self-served | No — read-only within permission scope | 1 |
| `AI-STU-03` | Document OCR & extraction | [Student management](../03-modules/student-management.md) | Intake | Extracts fields from uploaded birth certificates/prior records to pre-fill registration. (Inputs: uploaded documents) | Registration data-entry reduced | Yes — human confirms every extracted value before save | 1 |
| `AI-STU-04` | Student 360 summary | [Student management](../03-modules/student-management.md) | Sync ask | NL summary of a student's history (enrollment, attendance, results, notes) for teacher–parent meetings; marked AI-generated. (Inputs: student record in caller scope) | Meeting prep minutes per student cut | No — read-only, labeled, permission-scoped | 2 |
| `AI-LIB-03` | Catalog OCR / metadata extraction | [Library](../03-modules/library.md) | Intake | Extracts title/author/ISBN/publisher from cover or copyright-page photos during cataloging. (Inputs: book photos, ISBN APIs) | Cataloging throughput increased | Yes — librarian confirms every field before save | 1 |

## 4. Students

Student-facing surfaces are the most constrained class: `own`-scope data only, age-appropriate system prompts with hard topic guardrails, and no exposure of any risk scoring (see [`ai-governance.md`](ai-governance.md) §1 and §3).

| ID | Feature | Module | Pattern | What it does (Inputs) | Measurable value | Approval | Wave |
| -- | ------- | ------ | ------- | --------------------- | ---------------- | -------- | ---- |
| `AI-PAR-03` | AI study assistant (student view) | [Parent portal](../03-modules/parent-portal.md) | Sync ask | Syllabus-aware explanations and practice questions for the student's own classes; age-appropriate content policy enforced; no access to other students' data. (Inputs: own-scope syllabus, published class materials) | Study-help availability outside school hours | No — hard guardrails + own-scope only; never answers about other students | 3 |
| `AI-LIB-01` | Reading recommendations | [Library](../03-modules/library.md) | Batch | Suggests titles per student in the portal; recommendations only, no auto-reservations. (Inputs: grade level, borrow history, curriculum subjects) | Borrow rate per student increased | No — suggestions only | 3 |
| `AI-LIB-02` | Natural-language catalog search | [Library](../03-modules/library.md) | Sync ask | "Story books in Urdu for class 3" resolved to catalog filters; falls back to standard full-text search on low confidence. (Inputs: catalog metadata) | Catalog findability improved | No — read-only with deterministic fallback | 1 |

## 5. Parents

Guardian-facing features read only the guardian's own children's records, are strictly read-only (no payments, no record changes), and cite the data behind every answer.

| ID | Feature | Module | Pattern | What it does (Inputs) | Measurable value | Approval | Wave |
| -- | ------- | ------ | ------- | --------------------- | ---------------- | -------- | ---- |
| `AI-PAR-01` | AI parent assistant | [Parent portal](../03-modules/parent-portal.md) | Sync ask | NL Q&A over the guardian's own children only ("what fees are due?"); read-only tool calls; never initiates payments; answers carry data citations. (Inputs: own-children records via `own`-scoped tools) | Front-office query volume reduced; parent engagement up | No — read-only, own-scope, cited | 3 |
| `AI-PAR-02` | Child performance digest | [Parent portal](../03-modules/parent-portal.md) | Batch | Periodic plain-language summary of attendance/results trends per child, generated on publish events; guardian can disable the category. (Inputs: published attendance/results for own children) | Parent awareness without staff effort | No — built only from already-published, already-approved data; labeled AI-generated | 3 |

## 6. Cross-cutting

Features owned by the AI gateway itself rather than a single module. They carry the `GEN` prefix and appear here in addition to the persona sections above where their users sit.

| ID | Feature | Module | Pattern | What it does (Inputs) | Measurable value | Approval | Wave |
| -- | ------- | ------ | ------- | --------------------- | ---------------- | -------- | ---- |
| `AI-GEN-03` | Cross-module natural-language search *(not yet referenced by a module doc)* | Cross-cutting (AI gateway) | Sync ask | One search box over all enabled modules' data ("show Ali Khan's fee status and attendance"), routing to the per-module NL query features (`AI-ATT-04`, `AI-SCH-02`, `AI-STF-03`, `AI-FEE-02`, `AI-TRN-03`, `AI-LIB-02`, `AI-ACA-04`) and merging permission-scoped results. (Inputs: whitelisted read tools across modules, caller scope) | Single entry point for scope §6 "natural-language search across school data" | No — read-only; every routed query logged | 1 |

## 7. Delivery & Phasing

All AI features ship in **Phase 3** ([`../01-phases/phase-3-ai.md`](../01-phases/phase-3-ai.md)), after the AI gateway is built and before any feature reaches a pilot tenant. The phase doc defines four waves, ordered so low-risk drafting ships before analytics that could influence decisions about children:

| Wave | Focus | Registry entries |
| ---- | ----- | ---------------- |
| 1 | Admin/staff drafting, summarization, NL access, document intake | `AI-GEN-01`, `AI-GEN-03`, `AI-SCH-01/02`, `AI-PLA-01/03`, `AI-ADM-03`, `AI-COM-02/03`, `AI-FEE-02`, `AI-HRL-03`, `AI-INV-02`, `AI-TRN-03`, `AI-STF-02/03`, `AI-CRT-01/02/03`, `AI-WEB-01/02/03`, `AI-RPT-01/02`, `AI-ATT-04`, `AI-ACA-04`, `AI-STU-03`, `AI-LIB-02/03` |
| 2 | Teacher tooling | `AI-GEN-02`, `AI-ACA-01`, `AI-EXM-01/02`, `AI-STU-04` |
| 3 | Student/parent assistants and approved outbound suggestions | `AI-PAR-01/02/03`, `AI-COM-01`, `AI-ATT-03`, `AI-FEE-03`, `AI-ADM-02`, `AI-LIB-01` |
| 4 | Risk analytics and operations recommendations | `AI-STU-01/02`, `AI-ATT-01/02`, `AI-EXM-03/04`, `AI-FEE-01/04`, `AI-ADM-01/04`, `AI-HRL-01/02`, `AI-INV-01/03`, `AI-TRN-01/02`, `AI-TTB-01/02/03/04`, `AI-STF-01/04`, `AI-SCH-03`, `AI-ACA-02/03`, `AI-RPT-03`, `AI-PLA-02` |

Every feature launches behind a per-tenant, per-plan feature flag with a kill switch; rollout is progressive (internal tenant → pilot tenants → default-on per plan). Features marked *(recommendation)* are proposals beyond the confirmed scope and require client sign-off before entering a wave.

## 8. Scope §6 Coverage Map

Every capability listed in scope §6 resolves to at least one registry entry:

| Scope §6 capability | Registry entries |
| ------------------- | ---------------- |
| AI school assistant | `AI-GEN-01` |
| AI chatbot for administrators | `AI-GEN-01` (administrator surface with admin-specific tools) |
| AI assistant for teachers | `AI-GEN-02` |
| AI assistant for students | `AI-PAR-03` |
| AI assistant for parents | `AI-PAR-01` |
| Natural-language search across school data | `AI-GEN-03`, routing to `AI-ATT-04`, `AI-SCH-02`, `AI-STF-03`, `AI-FEE-02`, `AI-TRN-03`, `AI-LIB-02`, `AI-ACA-04` |
| AI-generated reports | `AI-RPT-02` (with `AI-HRL-03` for HR) |
| AI-generated announcements | `AI-COM-02` |
| AI-generated notices | `AI-COM-02`, `AI-COM-03` |
| AI-generated lesson plans | `AI-ACA-01` |
| AI-generated assignments | `AI-ACA-01` (assignment drafts seeded from lesson plans) |
| AI-generated quizzes | `AI-EXM-01` (quiz delivery lives in examinations per academics §14) |
| AI-generated exam questions | `AI-EXM-01` |
| AI question-bank generation | `AI-EXM-01` |
| AI grading assistance | `AI-EXM-02` |
| Student performance analysis | `AI-EXM-03` |
| At-risk student detection | `AI-STU-01` (+ `AI-ATT-02` attendance signal) |
| Attendance anomaly detection | `AI-ATT-01` (students), `AI-HRL-01` (staff) |
| Dropout-risk indicators | `AI-STU-02` |
| Fee/payment prediction | `AI-FEE-01` |
| Academic performance insights | `AI-ACA-04` |
| Teacher performance insights | `AI-STF-01` |
| Smart timetable recommendations | `AI-TTB-01`, `AI-TTB-04` |
| Timetable conflict detection | **Deterministic conflict engine** ([timetable](../03-modules/timetable.md) §7 — validation, not AI) + AI swap suggestions via `AI-TTB-02` |
| Admission lead scoring | `AI-ADM-01` |
| AI admission assistant | `AI-ADM-02` |
| AI document summarization | `AI-CRT-01` |
| OCR/document extraction | `AI-ADM-03`, `AI-STU-03`, `AI-STF-02`, `AI-CRT-03`, `AI-INV-02`, `AI-LIB-03`, `AI-PLA-01` |
| Smart recommendations | `AI-SCH-03`, `AI-ACA-03`, `AI-TTB-03`, `AI-STF-04`, `AI-LIB-01`, `AI-INV-01`, `AI-TRN-01`, `AI-FEE-03` |
| AI-powered analytics | The batch-analytics family across §2–§5 tables |
| Natural-language dashboard queries | `AI-RPT-01` |
| Predictive analytics | `AI-FEE-01`, `AI-ADM-04`, `AI-HRL-02`, `AI-INV-01`, `AI-TRN-02`, `AI-RPT-03`, `AI-PLA-02` |
| Automated parent communication suggestions | `AI-COM-01` (+ `AI-ATT-03`, `AI-FEE-03` module entry points) |

Also registered from module docs beyond scope §6 (all advisory or human-gated): `AI-ATT-02` at-risk/dropout indicator (attendance signal), `AI-EXM-04` result anomaly screening, `AI-FEE-04` payroll/expense anomalies, `AI-HRL-01/02/03` HR analytics and summaries, `AI-INV-03` asset anomalies, `AI-TRN-02` predictive maintenance, `AI-CRT-02` template drafting, `AI-WEB-02/03` SEO and alt-text, `AI-PLA-01/02/03` platform features, `AI-STU-04` student 360 summary, `AI-ADM-04` demand forecasting, `AI-ACA-02/03` promotion and allocation recommendations, `AI-SCH-01/03` setup copilot and structure recommendations.

`AI-ATT-02` — **At-risk / dropout-risk indicator (attendance signal)** ([Attendance](../03-modules/attendance.md), Batch, wave 4, no approval — advisory, visible to `principal`/`class_teacher` only): the attendance-side contribution to the composite risk scores owned by `AI-STU-01`/`AI-STU-02`; listed here so the registry is complete.

## 9. Registry Integrity

Audit of all `AI-*` references across `docs/03-modules/` (2026-08-16):

- **No ID conflicts found** — no ID is used with different meanings in different module docs. Every ID above carries the semantics of the module doc that coined it.
- **Intentional overlaps (not conflicts), flagged for implementation dedupe (recommendation):**
  1. **Parent-communication suggestions** appear three times: `AI-COM-01` (cross-module hub), `AI-ATT-03` (absence follow-ups), `AI-FEE-03` (fee reminders). Consistent semantics — the module features should be entry points into one gateway pipeline so approval flow and templates aren't built three times.
  2. **Risk scoring** spans `AI-STU-01`/`AI-STU-02` (composite owners) and `AI-ATT-02` (attendance signal, explicitly described as shared with `AI-EXM-03` output). One scoring pipeline should serve all three surfaces.
  3. **OCR/extraction** is registered per module (`AI-ADM-03`, `AI-STU-03`, `AI-STF-02`, `AI-CRT-03`, `AI-INV-02`, `AI-LIB-03`, `AI-PLA-01`) — same document-intake pattern with module-specific field schemas; implement as one gateway intake service with per-feature schemas.
- **IDs assigned by this catalog** (not yet referenced by a module doc): `AI-GEN-01`, `AI-GEN-02`, `AI-GEN-03`.
