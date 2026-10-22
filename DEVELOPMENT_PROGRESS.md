# Development progress

All twelve navigation modules are implemented against the SQLite services.

| Module | Status |
| --- | --- |
| Dashboard | Live totals, size cards, and charts from the database |
| Cylinder inventory | Opening stock, adjustments, movement history |
| Customers | Create, edit, search, archive, profile, export |
| Dispatch | Multi-size documents, stock check, challan, reversal |
| Receive | Partial and mixed returns, reconciliation, reversal |
| Cylinder ledger | Running balances, filters, Excel and PDF |
| Outstanding | Holdings and overdue flag |
| Reports | Inventory, outstanding, stock by size, dispatch, return, ledger, movement, overdue, month-end, damaged and lost, customer register |
| Notifications | Month-end notices, read state, report export |
| Settings | Company, sizes, theme, dates, backup, notifications |
| Backup and restore | Manual, launch backup, integrity check, typed restore |
| Audit logs | Append-only history of the operations above |

Also done:

- Drizzle schema and migration `001_init`
- Typed IPC allowlist, context isolation, Node integration off in the renderer
- Light theme tokens, collapsible sidebar, command palette, toasts
- Optional demonstration data, separated with `is_demo`
- Vitest business rules, a React Testing Library empty-state test, and a Playwright dispatch/return flow
- NSIS installer `release/CylinderFlow-Setup-1.0.0.exe`

Not in this version:

- Serial numbers on individual cylinders
- Operator passwords
- A background job that notifies the user after the app has quit
- Code signing of the installer
