/* config.js — YOUR configuration goes here.
   This is the ONLY file you need to edit to enable Google Drive backup.

   1. Go to https://console.cloud.google.com/ and create (or pick) a project.
   2. Enable the "Google Drive API" under APIs & Services > Library.
   3. Go to APIs & Services > Credentials > Create Credentials > OAuth client ID.
      - Application type: "Web application"
      - Authorized JavaScript origins: add the exact URL you will host this
        app on, e.g. https://yourname.github.io or https://yoursite.netlify.app
        (and http://localhost:5500 / whatever port, for local testing).
      - No redirect URI is needed — this app uses the Google Identity
        Services token flow, which works entirely in the browser.
   4. Copy the "Client ID" (ends in .apps.googleusercontent.com) and paste
      it below.
   5. On the OAuth consent screen, add the "drive.file" scope. This scope
      only ever gives the app access to files IT creates — never your
      whole Drive.

   Until GOOGLE_CLIENT_ID is filled in, the Google Drive backup buttons
   will show a clear "not configured" message instead of silently failing. */

const GOOGLE_CLIENT_ID = ''; // <-- paste your OAuth Client ID here, e.g. '123456-abc.apps.googleusercontent.com'
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
