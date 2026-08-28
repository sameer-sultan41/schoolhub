# Entities: Library, Transport, Inventory & Assets

> **Agent Context** — Load this block first.
> **Summary:** Column-level specs for three modules' tables — library (`book_*`, `library_*`), transport (`vehicles`, `drivers`, `routes`, `route_stops`, `student_transport_assignments`, `vehicle_maintenance`), and inventory/assets (`suppliers`, `asset_*`, `stock_*`, `purchase_order*`). All tables are tenant-owned and carry the implicit standard columns (id UUID PK, tenant_id FK, created_at/updated_at, created_by/updated_by, deleted_at) per [`../database-architecture.md`](../../02-architecture/database-architecture.md); only exceptions are stated. Monetary columns are `numeric(12,2)` in the tenant's configured currency — no currency assumed.
> **Co-load with:** `../../03-modules/library.md` · `../../03-modules/transport.md` · `../../03-modules/inventory-assets.md` · `people.md` (students, staff) · `academics.md` (campuses, rooms, academic_sessions) · `finance.md` (fines, expenses, budgets)

## Library

### book_categories

Hierarchical category tree for the catalog (also classifies stock via `asset_categories` — distinct tree).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(100) | NO | — | UNIQUE `(tenant_id, parent_id, name)` |
| parent_id | uuid | YES | — | FK → `book_categories.id` (self-referencing) |
| description | text | YES | — | |

Indexes: UNIQUE `(tenant_id, parent_id, name)`.
Relationships: self 1:N (parent/children); 1:N `book_titles`.

### book_titles

Bibliographic works — one row per title/edition; physical stock lives in `book_copies`.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| title | varchar(255) | NO | — | |
| subtitle | varchar(255) | YES | — | |
| authors | varchar(255) | NO | — | Comma-separated author names; normalized `authors` table deferred (module doc §19) |
| isbn | varchar(20) | YES | — | UNIQUE `(tenant_id, isbn)` where not null |
| publisher | varchar(150) | YES | — | |
| edition | varchar(50) | YES | — | |
| publication_year | smallint | YES | — | |
| language | varchar(50) | YES | — | |
| book_category_id | uuid | YES | — | FK → `book_categories.id` |
| cover_file_id | uuid | YES | — | FK → `files.id` |
| description | text | YES | — | |
| total_copies | integer | NO | `0` | Denormalized counter, maintained by copy triggers/service |
| available_copies | integer | NO | `0` | Denormalized; source of truth is `book_copies.status` |

Indexes: partial UNIQUE `(tenant_id, isbn)`; GIN full-text `(title, subtitle, authors)`; `(tenant_id, book_category_id)`.
Relationships: N:1 `book_categories`; 1:N `book_copies`; N:1 `files` (cover).

### book_copies

Physical, accession-numbered items of a title.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| book_title_id | uuid | NO | — | FK → `book_titles.id` |
| accession_no | varchar(50) | NO | — | UNIQUE `(tenant_id, accession_no)` |
| barcode | varchar(100) | YES | — | UNIQUE `(tenant_id, barcode)` where not null |
| campus_id | uuid | YES | — | FK → `campuses.id` |
| shelf_location | varchar(100) | YES | — | |
| supplier_id | uuid | YES | — | FK → `suppliers.id` |
| purchase_date | date | YES | — | |
| purchase_price | numeric(12,2) | YES | — | Basis for lost-book replacement fines |
| condition | varchar(10) | NO | `'good'` | Enum: `new`, `good`, `fair`, `damaged` |
| status | varchar(10) | NO | `'available'` | Enum: `available`, `issued`, `reserved`, `lost`, `damaged`, `withdrawn` |

Indexes: UNIQUE `(tenant_id, accession_no)`; partial UNIQUE `(tenant_id, barcode)`; `(tenant_id, book_title_id, status)`.
Relationships: N:1 `book_titles`; N:1 `campuses`; N:1 `suppliers`; 1:N `book_issues`.

### library_members

Membership and quota state for borrowers (students and staff).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| user_id | uuid | YES | null | FK → `users.id`; UNIQUE `(tenant_id, user_id)` where not null; null for students without portal accounts (student_id set instead) |
| member_type | varchar(10) | NO | — | Enum: `student`, `staff` |
| student_id | uuid | YES | null | FK → `students.id`; required when member_type = `student`; CHECK: exactly one of user_id/student_id populated per type |
| member_no | varchar(50) | NO | — | UNIQUE `(tenant_id, member_no)`; printed on card |
| max_books | smallint | NO | — | Defaulted from tenant library policy at creation |
| max_loan_days | smallint | NO | — | Defaulted from tenant library policy |
| status | varchar(10) | NO | `'active'` | Enum: `active`, `suspended`, `closed`; auto-suspended on student withdrawal/transfer |
| joined_on | date | NO | — | |

Indexes: UNIQUE `(tenant_id, user_id)` where user_id not null; UNIQUE `(tenant_id, student_id)` where student_id not null; UNIQUE `(tenant_id, member_no)`.
Relationships: N:1 `users`, `students`; 1:N `book_issues`; 1:N `library_fines`.

### book_issues

Circulation transactions: issue → renew → return lifecycle per copy.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| book_copy_id | uuid | NO | — | FK → `book_copies.id`; partial UNIQUE on open rows (`status IN ('issued','overdue')`) |
| library_member_id | uuid | NO | — | FK → `library_members.id` |
| issued_on | date | NO | — | |
| due_on | date | NO | — | `issued_on + member.max_loan_days`; librarian override audited |
| returned_on | date | YES | — | |
| renewals_count | smallint | NO | `0` | Capped by tenant policy |
| status | varchar(10) | NO | `'issued'` | Enum: `issued`, `overdue`, `returned`, `lost` |
| condition_on_return | varchar(10) | YES | — | Enum: `good`, `fair`, `damaged` |

Indexes: partial UNIQUE `(tenant_id, book_copy_id) WHERE status IN ('issued','overdue')`; `(tenant_id, library_member_id, status)`; `(tenant_id, due_on) WHERE returned_on IS NULL`.
Relationships: N:1 `book_copies`; N:1 `library_members`; 1:N `library_fines`.

### library_fines

Fines assessed by the library; collection happens in fees-finance after posting.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| book_issue_id | uuid | NO | — | FK → `book_issues.id` |
| library_member_id | uuid | NO | — | FK → `library_members.id` (denormalized for member statements) |
| fine_type | varchar(10) | NO | — | Enum: `overdue`, `lost`, `damage` |
| amount | numeric(12,2) | NO | — | Per-day rate × days (capped) or replacement cost |
| status | varchar(10) | NO | `'pending'` | Enum: `pending`, `posted`, `paid`, `waived` |
| posted_fine_id | uuid | YES | — | FK → `fines.id` ([`finance.md`](finance.md)); set on posting, idempotent |
| waived_by | uuid | YES | — | FK → `users.id`; must differ from assessor |
| waived_reason | text | YES | — | Required when waived |

Indexes: `(tenant_id, library_member_id, status)`; UNIQUE `(posted_fine_id)` where not null.
Relationships: N:1 `book_issues`; N:1 `library_members`; 1:1 finance `fines` once posted.

## Transport

### vehicles

Fleet register with capacity, compliance dates, and operational status.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| registration_no | varchar(50) | NO | — | UNIQUE `(tenant_id, registration_no)` |
| vehicle_type | varchar(15) | NO | — | Enum: `bus`, `van`, `coaster`, `car`, `other` |
| make_model | varchar(100) | YES | — | |
| capacity | smallint | NO | — | Seats; caps active route assignments |
| campus_id | uuid | YES | — | FK → `campuses.id` |
| ownership | varchar(15) | NO | `'owned'` | Enum: `owned`, `leased`, `contracted` |
| insurance_expiry | date | YES | — | Alert-driving |
| fitness_expiry | date | YES | — | Alert-driving |
| gps_device_id | varchar(100) | YES | — | Reserved for future tracking integration (module doc §17) |
| status | varchar(15) | NO | `'active'` | Enum: `active`, `in_maintenance`, `retired` |

Indexes: UNIQUE `(tenant_id, registration_no)`; `(tenant_id, status)`.
Relationships: N:1 `campuses`; 1:N `routes` (as current vehicle); 1:N `vehicle_maintenance`.

### drivers

Transport staff records (driver/conductor/attendant), linked 1:1 to `staff`.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| staff_id | uuid | NO | — | FK → `staff.id`; UNIQUE `(tenant_id, staff_id)` |
| transport_role | varchar(10) | NO | `'driver'` | Enum: `driver`, `conductor`, `attendant` |
| license_no | varchar(50) | NO | — | |
| license_type | varchar(50) | YES | — | |
| license_expiry | date | NO | — | Alert-driving |
| verification_date | date | YES | — | Background/police verification (recommendation) |
| status | varchar(10) | NO | `'active'` | Enum: `active`, `inactive` |

Indexes: UNIQUE `(tenant_id, staff_id)`; `(tenant_id, license_expiry)`.
Relationships: N:1 `staff`; 1:N `routes` (as current driver/attendant).

### routes

Named routes with current vehicle/driver allocation and shift.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(100) | NO | — | UNIQUE `(tenant_id, name)` |
| code | varchar(20) | YES | — | Short label for manifests |
| campus_id | uuid | YES | — | FK → `campuses.id` |
| vehicle_id | uuid | YES | — | FK → `vehicles.id`; current allocation, must be `active` |
| driver_id | uuid | YES | — | FK → `drivers.id`; current allocation |
| attendant_id | uuid | YES | — | FK → `drivers.id` (conductor/attendant) |
| shift | varchar(10) | NO | `'both'` | Enum: `morning`, `afternoon`, `both` |
| default_fee_amount | numeric(12,2) | YES | — | Route-level fee tier; billed via fees-finance `fee_heads` mapping |
| status | varchar(10) | NO | `'active'` | Enum: `active`, `inactive` |

Indexes: UNIQUE `(tenant_id, name)`; `(tenant_id, vehicle_id)`.
Relationships: N:1 `campuses`, `vehicles`, `drivers` (driver + attendant); 1:N `route_stops`; 1:N `student_transport_assignments`.

### route_stops

Ordered stops on a route with times, coordinates, and optional fee override.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| route_id | uuid | NO | — | FK → `routes.id` |
| name | varchar(150) | NO | — | |
| sequence | smallint | NO | — | UNIQUE `(route_id, sequence)` |
| pickup_time | time | YES | — | Local to tenant timezone |
| drop_time | time | YES | — | |
| latitude | numeric(9,6) | YES | — | For future tracking/route optimization |
| longitude | numeric(9,6) | YES | — | |
| fee_amount | numeric(12,2) | YES | — | Stop-level tier; overrides `routes.default_fee_amount` |

Indexes: UNIQUE `(route_id, sequence)`; `(tenant_id, route_id)`.
Relationships: N:1 `routes`; referenced by `student_transport_assignments` (pickup/drop).

### student_transport_assignments

Session-bound assignment of a student to a route and stop(s); drives transport billing.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| student_id | uuid | NO | — | FK → `students.id`; partial UNIQUE — one row per student `WHERE status = 'active'` |
| route_id | uuid | NO | — | FK → `routes.id` |
| pickup_stop_id | uuid | NO | — | FK → `route_stops.id`; must belong to `route_id` |
| drop_stop_id | uuid | YES | — | FK → `route_stops.id`; NULL = same as pickup |
| academic_session_id | uuid | NO | — | FK → `academic_sessions.id` |
| start_date | date | NO | — | |
| end_date | date | YES | — | ≥ start_date; set on withdrawal/change |
| status | varchar(10) | NO | `'active'` | Enum: `active`, `suspended`, `ended` |

Indexes: partial UNIQUE `(tenant_id, student_id) WHERE status = 'active'`; `(tenant_id, route_id, status)`.
Relationships: N:1 `students`, `routes`, `route_stops` (×2), `academic_sessions`.

### vehicle_maintenance

Scheduled and reactive maintenance events per vehicle, with cost posting to finance.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| vehicle_id | uuid | NO | — | FK → `vehicles.id` |
| maintenance_type | varchar(15) | NO | — | Enum: `service`, `repair`, `inspection`, `tires`, `other` |
| description | text | YES | — | |
| scheduled_on | date | YES | — | |
| performed_on | date | YES | — | |
| odometer_km | integer | YES | — | Feeds cost-per-km reporting |
| cost | numeric(12,2) | YES | — | |
| supplier_id | uuid | YES | — | FK → `suppliers.id` (workshop) |
| expense_id | uuid | YES | — | FK → `expenses.id` ([`finance.md`](finance.md)); set on completion, idempotent |
| next_due_on | date | YES | — | Computed for recurring services |
| status | varchar(15) | NO | `'scheduled'` | Enum: `scheduled`, `in_progress`, `completed`, `canceled` |

Indexes: `(tenant_id, vehicle_id, status)`; `(tenant_id, next_due_on)`.
Relationships: N:1 `vehicles`, `suppliers`; 1:1 finance `expenses` once posted.

## Inventory & Assets

### suppliers

Vendor register shared across inventory purchases, transport workshops, and library book vendors.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(150) | NO | — | UNIQUE `(tenant_id, name)` |
| contact_person | varchar(100) | YES | — | |
| phone | varchar(30) | YES | — | |
| email | varchar(255) | YES | — | |
| address | text | YES | — | |
| tax_no | varchar(50) | YES | — | Tenant-jurisdiction tax/registration id |
| categories | jsonb | YES | — | Tags: e.g. `stationery`, `books`, `workshop` |
| status | varchar(10) | NO | `'active'` | Enum: `active`, `inactive` |

Indexes: UNIQUE `(tenant_id, name)`.
Relationships: 1:N `purchase_orders`, `assets`, `book_copies`, `vehicle_maintenance`, `asset_maintenance`.

### asset_categories

Hierarchical category tree for assets and stock items.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(100) | NO | — | UNIQUE `(tenant_id, parent_id, name)` |
| parent_id | uuid | YES | — | FK → `asset_categories.id` (self-referencing) |
| depreciation_rate | numeric(5,2) | YES | — | % per year; computation deferred to fees-finance phase 2 (recommendation) |

Indexes: UNIQUE `(tenant_id, parent_id, name)`.
Relationships: self 1:N; 1:N `assets`; 1:N `stock_items`.

### assets

Individually tagged fixed assets with lifecycle status and custody.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| asset_tag | varchar(50) | NO | — | UNIQUE `(tenant_id, asset_tag)`; auto-sequenced, printable QR/barcode |
| name | varchar(150) | NO | — | |
| asset_category_id | uuid | YES | — | FK → `asset_categories.id` |
| serial_no | varchar(100) | YES | — | Manufacturer serial |
| campus_id | uuid | YES | — | FK → `campuses.id` |
| supplier_id | uuid | YES | — | FK → `suppliers.id` |
| purchase_order_id | uuid | YES | — | FK → `purchase_orders.id`; set when spawned from receiving |
| purchase_date | date | YES | — | |
| purchase_cost | numeric(12,2) | YES | — | |
| warranty_expiry | date | YES | — | Alert-driving |
| condition | varchar(10) | NO | `'good'` | Enum: `new`, `good`, `fair`, `poor`, `broken` |
| status | varchar(20) | NO | `'in_store'` | Enum: `in_store`, `assigned`, `under_maintenance`, `disposed`, `lost` |

Indexes: UNIQUE `(tenant_id, asset_tag)`; `(tenant_id, status)`; `(tenant_id, asset_category_id)`.
Relationships: N:1 `asset_categories`, `campuses`, `suppliers`, `purchase_orders`; 1:N `asset_assignments`, `asset_maintenance`.

### asset_assignments

Dated custody records — an asset assigned to exactly one of a staff member or a room.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| asset_id | uuid | NO | — | FK → `assets.id`; partial UNIQUE — one row per asset `WHERE status = 'active'` |
| assignee_type | varchar(10) | NO | — | Enum: `staff`, `room` |
| staff_id | uuid | YES | — | FK → `staff.id`; CHECK: exactly one of staff_id/room_id set, matching assignee_type |
| room_id | uuid | YES | — | FK → `rooms.id` ([`academics.md`](academics.md)) |
| assigned_on | date | NO | — | |
| due_back_on | date | YES | — | |
| returned_on | date | YES | — | |
| condition_on_return | varchar(10) | YES | — | Enum: `good`, `fair`, `poor`, `broken` |
| status | varchar(10) | NO | `'active'` | Enum: `active`, `returned` |

Indexes: partial UNIQUE `(tenant_id, asset_id) WHERE status = 'active'`; `(tenant_id, staff_id)`; `(tenant_id, room_id)`.
Relationships: N:1 `assets`, `staff`, `rooms`.

### asset_maintenance

Maintenance events for assets/equipment, with cost posting to finance.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| asset_id | uuid | NO | — | FK → `assets.id` |
| maintenance_type | varchar(15) | NO | — | Enum: `repair`, `service`, `inspection`, `calibration` |
| description | text | YES | — | |
| scheduled_on | date | YES | — | |
| performed_on | date | YES | — | |
| cost | numeric(12,2) | YES | — | |
| supplier_id | uuid | YES | — | FK → `suppliers.id` |
| expense_id | uuid | YES | — | FK → `expenses.id` ([`finance.md`](finance.md)); idempotent posting |
| next_due_on | date | YES | — | |
| status | varchar(15) | NO | `'scheduled'` | Enum: `scheduled`, `in_progress`, `completed`, `canceled` |

Indexes: `(tenant_id, asset_id, status)`; `(tenant_id, next_due_on)`.
Relationships: N:1 `assets`, `suppliers`; 1:1 finance `expenses` once posted.

### stock_items

Consumable catalog; balance is derived from `stock_movements` and denormalized here.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(150) | NO | — | |
| sku | varchar(50) | YES | — | UNIQUE `(tenant_id, sku)` where not null |
| asset_category_id | uuid | YES | — | FK → `asset_categories.id` (shared tree) |
| unit | varchar(20) | NO | — | e.g. `pcs`, `box`, `ream`, `liter` |
| campus_id | uuid | YES | — | FK → `campuses.id` (store location) |
| storage_location | varchar(100) | YES | — | Shelf/bin |
| reorder_level | numeric(12,2) | NO | `0` | Alert threshold |
| current_quantity | numeric(12,2) | NO | `0` | Denormalized from movement ledger; never edited directly |
| unit_cost | numeric(12,2) | YES | — | Moving-average cost (valuation recommendation, module doc §19) |
| status | varchar(10) | NO | `'active'` | Enum: `active`, `inactive` |

Indexes: partial UNIQUE `(tenant_id, sku)`; `(tenant_id, campus_id)`; partial `(tenant_id) WHERE current_quantity <= reorder_level` (reorder scan).
Relationships: N:1 `asset_categories`, `campuses`; 1:N `stock_movements`, `purchase_order_items`.

### stock_movements

Immutable quantity ledger — every stock change is one row; corrections are counter-movements.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| stock_item_id | uuid | NO | — | FK → `stock_items.id` |
| movement_type | varchar(15) | NO | — | Enum: `purchase_in`, `issue_out`, `return_in`, `adjustment`, `transfer_in`, `transfer_out`, `write_off` |
| quantity | numeric(12,2) | NO | — | Always positive; direction implied by type (`adjustment` carries signed effect in `balance_after`) |
| purchase_order_item_id | uuid | YES | — | FK → `purchase_order_items.id` for `purchase_in` |
| issued_to_staff_id | uuid | YES | — | FK → `staff.id` for `issue_out` |
| reference | varchar(150) | YES | — | Free-text: requisition no., transfer counterpart, audit session |
| reason | text | YES | — | Required for `adjustment`/`write_off` |
| balance_after | numeric(12,2) | NO | — | Snapshot after applying the movement |
| moved_at | timestamptz | NO | `now()` | |

Exceptions to standard columns: append-only — `updated_at/updated_by` unused; no soft delete (`deleted_at` unused).
Indexes: `(tenant_id, stock_item_id, moved_at DESC)`; `(tenant_id, movement_type)`.
Relationships: N:1 `stock_items`, `purchase_order_items`, `staff`.

### purchase_orders

Procurement headers with threshold-based approval and receiving lifecycle.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| po_no | varchar(50) | NO | — | UNIQUE `(tenant_id, po_no)`; tenant sequence |
| supplier_id | uuid | NO | — | FK → `suppliers.id` |
| status | varchar(20) | NO | `'draft'` | Enum: `draft`, `pending_approval`, `approved`, `ordered`, `partially_received`, `received`, `canceled` |
| order_date | date | YES | — | Set when `ordered` |
| expected_date | date | YES | — | |
| subtotal | numeric(12,2) | NO | `0` | Sum of line totals |
| tax_amount | numeric(12,2) | NO | `0` | Per tenant tax configuration |
| total_amount | numeric(12,2) | NO | `0` | subtotal + tax_amount |
| approved_by | uuid | YES | — | FK → `users.id`; must differ from `created_by` |
| approved_at | timestamptz | YES | — | |
| budget_id | uuid | YES | — | FK → `budgets.id` ([`finance.md`](finance.md)) (recommendation) |
| expense_id | uuid | YES | — | FK → `expenses.id`; posted on receipt, idempotent |
| notes | text | YES | — | |

Indexes: UNIQUE `(tenant_id, po_no)`; `(tenant_id, supplier_id, status)`.
Relationships: N:1 `suppliers`, `users` (approved_by), finance `budgets`/`expenses`; 1:N `purchase_order_items`; 1:N `assets` (spawned on receipt).

### purchase_order_items

Line items on a purchase order — stock replenishment or new-asset lines.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| purchase_order_id | uuid | NO | — | FK → `purchase_orders.id` |
| item_type | varchar(10) | NO | — | Enum: `stock_item`, `asset` |
| stock_item_id | uuid | YES | — | FK → `stock_items.id`; required when `item_type = 'stock_item'` |
| description | varchar(200) | YES | — | Required for `asset` lines (asset rows created at receipt) |
| quantity | numeric(12,2) | NO | — | > 0 |
| unit_price | numeric(12,2) | NO | — | |
| line_total | numeric(12,2) | NO | — | quantity × unit_price |
| received_quantity | numeric(12,2) | NO | `0` | ≤ quantity; drives PO `partially_received/received` status |

Indexes: `(tenant_id, purchase_order_id)`; `(tenant_id, stock_item_id)`.
Relationships: N:1 `purchase_orders`, `stock_items`; 1:N `stock_movements` (receipts).
