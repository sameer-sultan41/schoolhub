# Module: <Module Name>

> **Agent Context** — Load this block first.
> **Summary:** <3–5 lines: what this module does, who uses it, and its one-sentence business value.>
> **Co-load with:** `../02-architecture/auth-and-rbac.md` · `../05-database/entities/<domain>.md` · <other sibling module docs this module depends on>
> **Owns entities:** <list of tables this module owns>
> **Depends on modules:** <list>

## 1. Purpose

<What the module does and the problem it solves. 1–2 paragraphs.>

## 2. Business Objective

<Why the module exists commercially/operationally. Measurable outcomes where possible.>

## 3. Target Users

| Role | How they use this module |
| ---- | ------------------------ |

## 4. Permissions

Permissions follow the RBAC model in [`auth-and-rbac.md`](../02-architecture/auth-and-rbac.md). Permission keys use `<module>.<resource>.<action>`.

| Permission key | Description | Default roles |
| -------------- | ----------- | ------------- |

## 5. Main Features

<Numbered list. Each feature: 1–3 sentences.>

## 6. Sub-features

<Grouped under each main feature.>

## 7. Workflows

<Mermaid flowchart(s) for the 1–3 core flows, each followed by a step-by-step description including actors, states, and approval gates.>

## 8. User Journeys

<Per relevant role: a short narrative journey through the module.>

## 9. Inputs

<Data entered into the module: forms, imports, API payloads, uploaded files.>

## 10. Outputs

<Data produced: records, documents, exports, events emitted.>

## 11. Validations

<Business and data validations, uniqueness rules, cross-module checks.>

## 12. Notifications

| Event | Recipients | Channels | Template ref |
| ----- | ---------- | -------- | ------------ |

Channels and delivery behavior follow [`notifications.md`](../02-architecture/notifications.md).

## 13. Reports

<List of reports with filters, groupings, and export formats. Role visibility per RBAC.>

## 14. AI Capabilities

<AI features surfaced in this module, each cross-referenced to [`ai-features.md`](../04-ai/ai-features.md) by feature ID (e.g. `AI-ATT-01`). State human-approval requirements.>

## 15. Database Entities

<Table names owned by this module with a one-line purpose each. Full column-level specs live in [`../05-database/entities/`](../05-database/entities/). Note tenant scoping.>

## 16. API Requirements

<REST resources and key endpoints, e.g. `GET/POST /api/v1/<resource>`. Conventions per [`api-architecture.md`](../02-architecture/api-architecture.md): pagination, filtering, errors, idempotency where relevant.>

## 17. Integration Requirements

<External services (payment gateways, SMS, email, storage) and internal platform services this module calls.>

## 18. Dependencies on Other Modules

| Module | Direction | What is shared |
| ------ | --------- | -------------- |

## 19. Open Questions / Recommendations

<Anything not client-confirmed, clearly labeled as a recommendation.>
