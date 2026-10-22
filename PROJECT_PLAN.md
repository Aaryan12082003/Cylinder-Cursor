# CylinderFlow project plan

CylinderFlow is an offline Electron desktop application. Business rules live in `core/` and are tested without Electron. The Electron main process opens SQLite, registers an allowlisted IPC API, and serves the same handlers to a localhost-only development bridge. React never opens the database.

## Phases

1. Architecture, SQLite schema, and migrations.
2. Light design system, sidebar, and shared controls.
3. Inventory and opening balances.
4. Customers.
5. Dispatch.
6. Returns.
7. Ledger and outstanding balances.
8. Dashboard.
9. Month-end snapshots and notifications.
10. Excel and PDF export.
11. Backup, restore, and settings.
12. Automated tests.
13. Windows NSIS packaging.

## Assumptions

1. Customer opening balances are cylinders already at the customer. They increase owned stock held by customers and do not reduce available stock.
2. Company opening stock is on-hand by condition. It is locked once any non-opening movement exists for that size.
3. Owned = filled + empty + with customers + damaged + under maintenance. Lost is excluded from owned. Available = filled + empty.
4. Inactive and archived customers cannot receive new dispatches. Returns are still allowed. Archive is reversible.
5. Historical documents are immutable. Corrections are full reversals or reconciliations.
6. Month-end snapshots cover ended months only and are computed from ledger entries on or before the last calendar day. The same period is never inserted twice.
7. Native notifications run only while the process is open. `notify_month_end` controls the in-app notice. `notify_native` controls the operating-system toast. Snapshots are still created when notices are off.
8. One line per size and condition on a document. A return condition does not have to match the dispatch condition.
9. Returning a cylinder as lost increases lost stock and clears outstanding.
10. The overdue flag uses days since the latest dispatch, return, or ledger date. The default threshold is 30 days.
11. Defaults follow Indian desk practice: INR display, `dd MMM yyyy`, 10-digit mobiles, 6-digit PIN, GSTIN check. Currency is not a price list.
12. One local operator. No login wall. SQLite WAL and a single-instance lock.
13. Business dates cannot be in the future relative to the application clock.
14. An authorized return above outstanding posts a reconciliation for the difference, then the return, in one transaction.
15. Adjustments cannot target the with-customer state. Use reconciliation for that.
16. Demonstration data loads only into an empty database and is marked `is_demo`.
17. Dispatch and return counts on the dashboard ignore reversed documents.
18. A size code cannot change after it is created.
