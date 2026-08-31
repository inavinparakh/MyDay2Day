# Navin Day Planner

*Plan. Remember. Complete.*

A single mobile-first web app that replaces Google Tasks + Google Calendar +
Clock for daily planning: todo list, time-based reminders, alarms, recurring
tasks, automatic carry-forward of unfinished tasks, and completed-task
history — all stored locally on the device (IndexedDB), with optional JSON
and Google Drive backup.

## 1. Architecture overview

Pure HTML/CSS/vanilla JS, no build step, no framework.

```
index.html          App shell: header, 5 views, bottom nav, FAB, modal roots
css/styles.css       All styling (light + dark theme via CSS variables)
manifest.json        PWA manifest
service-worker.js    Offline app-shell caching

js/config.js          <- YOUR Google OAuth Client ID goes here
js/db.js              IndexedDB wrapper + schema + defaults
js/utils.js           Date/time/formatting helpers (no DB, no DOM)
js/categories.js      Category CRUD
js/tasks.js           Task CRUD, carry-forward engine, recurrence engine
js/ui.js              Task card rendering + Add/Edit Task modal
js/calendar.js         Day / Week / Month calendar views
js/notifications.js   Web Notifications reminder engine
js/alarms.js          Standalone alarm clock + shared ringing screen
js/backup.js          Local JSON export/import/merge + backup history log
js/google-drive.js    Google Drive OAuth + upload/download via Drive REST API
js/settings.js        Settings screen (wires up everything above)
js/app.js             Bootstraps the app, owns navigation, renders Today/Tasks/Completed

icons/                 App icons (NDP monogram, generated)
```

Business logic (`db.js`, `utils.js`, `tasks.js`, `categories.js`,
`backup.js`) has no DOM references, so it can be reused unchanged if you
later wrap this in Capacitor for a native Android build (see §9).

**Task lifecycle:** every task is one persistent IndexedDB record with a
stable id. Completing a task never deletes it — it's moved to `status:
'completed'` with an exact `completedAt` timestamp and stays in Completed
History forever (unless you explicitly delete it). Carry-forward updates the
same record's `dueDate` and `status` rather than creating a new one, and
keeps the original `originalDate` and a running `carryForwardCount`.

**Recurring tasks** are stored as one template record (`recurrence` set,
`recurrenceParentId` null). Each day, or immediately when you create one, the
app checks whether the pattern matches today and — only if it hasn't already
— generates one real task instance for today, tagged with
`recurrenceParentId`. The template itself never shows up in your lists; only
its generated instances do. This is what prevents duplicate tasks.

## 2. How to run locally

Because this app uses a Service Worker and (optionally) Google OAuth, it
needs to be served over `http://localhost` or `https://` — opening
`index.html` directly via `file://` will work for basic task management, but
the service worker (offline caching) and Google Drive login will not.

Quickest option, from this folder:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` on your computer, or on your Android phone
if it's on the same Wi-Fi network (use your computer's local IP instead of
`localhost`).

Any static server works: `npx serve`, VS Code's "Live Server" extension, etc.

## 3. Hosting for real use (free, static)

Push this folder to a GitHub repository and enable **GitHub Pages**
(Settings → Pages → deploy from branch), or drag-and-drop the folder into
**Netlify**. Both give you a permanent `https://` URL, which you need for:
- installing as a PWA on Android reliably,
- registering the OAuth origin for Google Drive (§5).

## 4. Install as an Android PWA

1. Open your hosted URL in Chrome on Android.
2. Tap the **⋮** menu → **Add to Home screen** (Chrome may also show an
   automatic "Install app" banner).
3. The app opens full-screen with its own icon, no browser chrome, and
   works offline for everything except Google Drive backup.

## 5. Configure Google Drive backup (optional)

Google Drive integration is real, not simulated — but it needs your own
OAuth credentials, because Client IDs are tied to the exact domain you host
on and can't be safely hard-coded for you in advance.

1. Go to <https://console.cloud.google.com/>, create or select a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Authorized JavaScript origins: add the exact URL you're hosting on
     (e.g. `https://yourname.github.io`) and, for local testing, something
     like `http://localhost:8000`.
   - No redirect URI needed (this uses Google Identity Services' in-browser
     token flow, not a server redirect).
4. On the OAuth consent screen, the app requests only the
   `drive.file` scope — it can only see/create files it makes itself, never
   your whole Drive.
5. Copy the Client ID (ends in `.apps.googleusercontent.com`) into
   **`js/config.js`**:
   ```js
   const GOOGLE_CLIENT_ID = 'your-id-here.apps.googleusercontent.com';
   ```
6. Reload the app → Settings → Google Drive Backup → **Connect Google
   Account**.

Until you do this, the Backup/Restore-from-Drive buttons are disabled and
show a plain "not configured" message — they never pretend to work.

## 6. Known browser/PWA limitations (please read)

**Reminders and alarms can only fire while this app's browser tab/PWA
process is alive.** This app checks for due reminders every 20 seconds while
open, and immediately whenever you bring it back to the foreground, and it
registers a service worker so it can still show notifications while
backgrounded (not fully closed). What it **cannot** do — and no
browser/PWA-based app truly can — is guarantee waking up at an exact future
time after Android has fully killed the tab or force-stopped the app, the
way a native alarm clock app with an exact system alarm can.

If you need bulletproof alarms even when the phone is locked and the browser
is fully closed, the practical path is to wrap this same codebase as a
native Android app using **Capacitor** (see §9) and use Capacitor's Local
Notifications / native alarm plugins, which do have OS-level exact-alarm
permission. The web app's business logic (`db.js`, `tasks.js`, `utils.js`,
`categories.js`, `backup.js`) needs no changes for that.

## 7. Data safety

- Nothing is ever silently deleted. Completing, cancelling, or carrying
  forward a task all just change its status — the record stays.
- Deleting a task or category always asks for confirmation first.
- Restoring a backup always shows you its date and task counts before
  applying, and lets you choose **Merge** (keeps existing data, updates
  matching IDs, adds new ones) or **Replace** (wipes and restores) —
  Replace asks for a second confirmation.
- Every local or Drive backup is logged in Settings → Backup History with
  its outcome.

## 8. Testing checklist (all verified working)

- [x] Create a task for today, close and reopen the app — task persists (IndexedDB).
- [x] Create a task for a past date — it automatically shows as Carried Forward with original + current date tracked.
- [x] Complete a carried-forward task — exact completion date/time recorded, moves to Completed History.
- [x] Create a daily recurring task — generates exactly one instance per day, never duplicates on repeated runs.
- [x] Export a local JSON backup, then re-import it (merge and replace both tested) — all records return correctly.
- [x] Search across tasks/notes/tags.
- [x] Dark mode toggle, and it persists across reload.
- [x] Offline load after first visit (service worker caches the app shell).
- [x] Notification permission flow shows a clear enabled/blocked/unsupported status.
- [x] Google Drive connect/backup/restore/disconnect — all show clear errors when not configured, and clear failure messages if a call fails.

## 9. Future native Android app (Capacitor)

This project is structured so you can later run:

```
npm install @capacitor/core @capacitor/cli
npx cap init "Navin Day Planner" "com.navinpune.dayplanner"
npx cap add android
```

point Capacitor's `webDir` at this folder, and swap `notifications.js` /
`alarms.js` to call `@capacitor/local-notifications` instead of the Web
Notifications API for OS-level exact alarms — everything in `db.js`,
`tasks.js`, `categories.js`, `utils.js`, and `backup.js` is plain JS with no
browser-only dependencies and can be reused as-is.
