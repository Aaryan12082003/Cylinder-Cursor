# CylinderFlow

Offline Windows desktop software for an industrial gas cylinder desk. It tracks owned stock, cylinders with customers, dispatches, returns, ledgers, month-end holding reports, and local backups.

The interface is a light SaaS desk: white surfaces, slate text, and indigo accents. Records live in a local SQLite database. The app does not need a network after installation.

## Run it

```bash
npm install
npm run rebuild:native
npm run dev
```

`npm run dev` opens the Electron window and the renderer at [http://127.0.0.1:43123](http://127.0.0.1:43123). In development the window and the browser talk to the same local handlers.

On Windows, after `npm run dist`, install `release/CylinderFlow-Setup-1.0.0.exe`. The installer creates a desktop shortcut and a Start menu shortcut. No Node.js install is required for the end user.

## Automatic updates from GitHub

Installed Windows builds check the public GitHub Releases feed for `Aaryan12082003/Cylinder-Cursor` after launch and periodically while the app is open. Updates download automatically in the background. CylinderFlow asks whether to restart when an update is ready; choosing **Restart now** installs it, while **Later** installs it the next time the app starts.

To publish an update:

1. Change the `version` in `package.json` (for example, from `1.0.0` to `1.0.1`).
2. Run `npm run dist` on Windows. This rebuilds the native SQLite dependency, creates the installer, and writes the update metadata (`latest.yml`).
3. Create a GitHub Release with a matching version tag such as `v1.0.1` and upload `CylinderFlow-Setup-1.0.1.exe`, its `.blockmap`, and `latest.yml`.

A normal source-code push alone does not update installed clients because there is no installer artifact for them to download. Do not publish a release with a lower or unchanged version number.

## Checks

```bash
npm test
npm run typecheck
npm run build
npx playwright test
npm run dist
```

`npm run dist` builds the NSIS installer for Windows x64. On Linux, Wine (including 32-bit Wine) is required because the packager edits the executable and runs NSIS. A Windows packaging run replaces the local `better-sqlite3` binary with a Windows build. Run `npm run rebuild:native` again before `npm run dev` on Linux.

## Where company data lives

The database is not inside the install folder.

- Windows: `%APPDATA%\CylinderFlow\cylinderflow.db`
- Linux development: the Electron `userData` directory, or `CYLINDERFLOW_USER_DATA` when that variable is set

Company logo files sit in a `branding` folder next to the database. Backups default to a `backups` folder next to the database unless Settings points somewhere else. Updates replace the program files and leave this folder alone.

## Backup and restore

1. Open **Backup & Restore**.
2. Choose a folder if you do not want the default location next to the database.
3. Click **Create backup**. CylinderFlow uses SQLite's online backup API and checks `PRAGMA integrity_check` before keeping the file.
4. Automatic backups run on launch when that setting is on. Retention defaults to 15 files whose names contain `cylinderflow-` inside the backup folder.
5. Restore asks you to type `RESTORE`. A copy of the current database is saved as `cylinderflow.db.before-restore` first. If the restore fails, that copy is put back.

Copy the database file while the app is closed if you want a manual copy outside the app.

## Business rules

- Default sizes are 3 Litre, 10 Litre, and 23 Litre. Settings can add more sizes without a code change. A size can be deactivated only when every balance for it is zero.
- Owned stock is filled + empty + with customers + damaged + under maintenance. Lost cylinders are tracked and are not part of owned stock. Available stock is filled + empty.
- Company opening stock is on-hand stock by condition. It is locked for a size after any later movement. Further changes use adjustments with a reason.
- A customer opening balance is stock already at that party on day one. It increases outstanding and cylinders with customers. It does not reduce available stock.
- A dispatch of several sizes is one database transaction. Stock is checked first. A shortfall rolls the whole document back.
- A return cannot exceed outstanding unless you authorize a reconciliation and give a reason. Returned cylinders enter the condition you record.
- Posted documents are not edited or deleted. Corrections are full-document reversals or reconciliations, and both are audited.
- Month-end snapshots are built for months that have already ended, from ledger rows dated on or before the last day. Generating the same month again does nothing. Native notifications are shown only while CylinderFlow is running. If the app was closed at month-end, the unread report appears the next time it launches. There is no scheduler after the process quits.

## Optional demonstration data

Settings can load a labelled sample only into an empty database. Every sample row is marked `is_demo`. Purge removes those rows and rebuilds balances from what remains. Do not load the sample into a company database you intend to keep.

## Known limitations

- Quantity tracking only. Cylinders are not serialised.
- One local operator name. There is no password.
- No cloud sync and no billing. Currency is a display preference and defaults to INR.
- Windows toast notifications require the app to be open.
- The customer dropdowns on dispatch and returns list the first 100 matching parties.
- The installer produced here is unsigned.
