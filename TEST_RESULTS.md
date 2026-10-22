# Test results

Run on 22 October 2026.

## Vitest

`npm test` — 3 files, 16 tests, all passed.

- Acceptance: opening 100 / 200 / 300, dispatch 10 / 20 / 30, available 90 / 180 / 270, outstanding 10 / 20 / 30, partial return 5 / 10 / 15, available 95 / 190 / 285, outstanding 5 / 10 / 15, 3 Litre ledger closing 5, consistency check empty.
- Every IPC channel is registered. An unknown channel is rejected.
- Customer opening does not reduce available stock.
- A multi-line dispatch with one short line rolls back and leaves no dispatch row.
- A return above outstanding is rejected. An authorized reconciliation return is accepted.
- Dispatch reversal restores filled stock and outstanding.
- Adjustment moves filled stock to damaged without changing owned quantity, and refuses a move that would go negative.
- Opening stock locks after a later movement.
- Search treats `%` and a quote-injection string as literals.
- Month-end January stays at 7 after a February dispatch, a second ensure is a no-op, February closes at 9, and unread notices are not duplicated.
- Restore returns the database to the earlier customer. Reopen after close keeps the party. Excel starts with `PK`. PDF starts with `%PDF-`.
- Empty-state heading renders. Initials for "ABC Industries" are `AI`.

## Typecheck and build

`npm run typecheck` passed for the renderer and the Node projects.

`npm run build` wrote `out/main`, `out/preload`, and `out/renderer`.

## Playwright

`npx playwright test` — 1 passed.

The browser opened inventory, saved opening stock 100 / 200 / 300, added Customer A, dispatched 10 / 20 / 30, received 5 / 10 / 15 back as filled, and showed total outstanding 30 plus available 95 / 190 / 285.

## Installer

`npx electron-builder --win --x64` produced:

- `release/CylinderFlow-Setup-1.0.0.exe` (PE32 NSIS installer, about 108 MB)
- `release/win-unpacked/CylinderFlow.exe` (PE32+ x64)
- Unpacked native module `resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node`

The installer was built on Linux with Wine. It was not launched on a Windows machine in this environment, and it is not code-signed.
