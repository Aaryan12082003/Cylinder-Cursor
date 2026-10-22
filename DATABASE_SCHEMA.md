# Database schema

SQLite, WAL, foreign keys on. Migration `001_init` is applied once and recorded in `schema_migrations`.

Inventory movements are the stock source of truth. Customer ledger entries are the outstanding source of truth. `inventory_balances` and `customer_balances` are updated in the same transaction and checked against those sums before commit.

## Tables

| Table | Role |
| --- | --- |
| `companies` | Single company row (`id = 1`): name, address, GSTIN, phone, email, logo |
| `users` | Local operator row used as the default actor |
| `cylinder_sizes` | Size code, name, litres, sort order, active flag. Codes are unique |
| `customers` | Party master. `code` is unique. `archived_at` is the soft archive |
| `inventory_balances` | One row per size. Non-negative filled, empty, with customer, damaged, lost, maintenance |
| `customer_balances` | Outstanding per customer and size |
| `document_sequences` | `CUST`, `DSP-year`, `RTN-year`, `ADJ-year`, `REC-year` counters |
| `opening_balances` | Company opening quantities by size |
| `customer_opening_balances` | Opening outstanding recorded for a customer |
| `dispatches` / `dispatch_items` | Header and lines. Unique number. Unique size+condition per document. `reversed_at` set by a reversal |
| `returns` / `return_items` | Same shape. Return condition may be filled, empty, damaged, lost, or maintenance |
| `customer_ledger_entries` | Opening, dispatched, returned, adjustment, closing. Closing = opening + dispatched − returned + adjustment |
| `inventory_movements` | Signed deltas by condition. Types include opening, customer opening, dispatch, return, reversals, adjustment, reconciliation |
| `inventory_adjustments` | Audited condition transfer with a reason |
| `reconciliations` | Audited outstanding correction |
| `month_end_snapshots` / `month_end_snapshot_items` | One snapshot per `period_key`. Item balances stored as JSON by size code |
| `notifications` | In-app notices. `dedupe_key` prevents a second month-end notice for the same period |
| `application_settings` | Key/value preferences and `installed_on` |
| `audit_logs` | Append-only action log |
| `backup_history` | Path, size, time, and kind of each backup |

## Indexes

Party name, mobile, customer status, ledger by customer and date, movements by size and date, dispatch and return dates, customers, and challan numbers, audit time, notification read state, snapshot items.

## Consistency

At the end of a stock mutation the service checks:

- movement deltas equal `inventory_balances` for every size
- ledger outstanding equals cylinders with customers
- each `customer_balances` row equals that customer's ledger

A mismatch throws and the transaction rolls back.
