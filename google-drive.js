/* google-drive.js — real Google Drive backup/restore using Google Identity
   Services (GIS) for OAuth and the Drive REST v3 API directly via fetch.
   No server component required, but it DOES require a Google OAuth Client
   ID — see js/config.js. Until that's set, every method here returns a
   clear "not configured" result instead of pretending to work. */

const DriveBackup = {
  APP_FOLDER_NAME: 'Navin Day Planner Backups',
  tokenClient: null,
  _gisLoaded: false,

  isConfigured() {
    return typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim().length > 0;
  },

  async loadGis() {
    if (this._gisLoaded) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Google Identity Services — check your internet connection.'));
      document.head.appendChild(script);
    });
    this._gisLoaded = true;
  },

  async connect() {
    if (!this.isConfigured()) {
      return { ok: false, error: 'Google Drive is not configured yet. Add your OAuth Client ID to js/config.js — see the comments in that file for exact steps.' };
    }
    try {
      await this.loadGis();
    } catch (e) {
      return { ok: false, error: e.message };
    }

    return new Promise((resolve) => {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: async (response) => {
          if (response.error) {
            resolve({ ok: false, error: `Google sign-in failed: ${response.error}` });
            return;
          }
          const expiry = Date.now() + (response.expires_in || 3600) * 1000;
          let email = null;
          try {
            const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${response.access_token}` }
            }).then(r => r.json());
            email = userInfo.email || null;
          } catch (e) { /* non-fatal */ }

          const folderId = await this._ensureAppFolder(response.access_token);

          await db.updateSettings({
            googleDrive: {
              connected: true,
              accessToken: response.access_token,
              tokenExpiry: expiry,
              folderId,
              email,
              lastBackup: null
            }
          });
          resolve({ ok: true, email });
        }
      });
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  },

  async disconnect() {
    const settings = await db.getSettings();
    const token = settings.googleDrive?.accessToken;
    if (token && window.google?.accounts?.oauth2) {
      try { google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* ignore */ }
    }
    await db.updateSettings({
      googleDrive: { connected: false, accessToken: null, tokenExpiry: null, folderId: null, email: null, lastBackup: null }
    });
  },

  async _getValidToken() {
    const settings = await db.getSettings();
    const gd = settings.googleDrive;
    if (!gd || !gd.connected) throw new Error('Not connected to Google Drive.');
    if (gd.tokenExpiry && Date.now() < gd.tokenExpiry - 60000) return gd.accessToken;

    // Token expired — silently request a fresh one (no prompt, since the
    // user already consented in this browser session).
    return new Promise((resolve, reject) => {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: async (response) => {
          if (response.error) { reject(new Error('Session expired — please reconnect Google Drive in Settings.')); return; }
          const expiry = Date.now() + (response.expires_in || 3600) * 1000;
          await db.updateSettings({ googleDrive: { ...gd, accessToken: response.access_token, tokenExpiry: expiry } });
          resolve(response.access_token);
        }
      });
      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  },

  async _ensureAppFolder(token) {
    const q = encodeURIComponent(`name='${this.APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());

    if (searchRes.files && searchRes.files.length > 0) return searchRes.files[0].id;

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    }).then(r => r.json());

    return createRes.id;
  },

  async backupNow() {
    if (!this.isConfigured()) return { ok: false, error: 'Google Drive is not configured. See js/config.js.' };
    try {
      const token = await this._getValidToken();
      const settings = await db.getSettings();
      const backup = await BackupManager.buildBackupObject();
      const filename = `Navin-Day-Planner-Backup-${todayKey()}.json`;
      const json = JSON.stringify(backup, null, 2);

      const metadata = { name: filename, parents: [settings.googleDrive.folderId], mimeType: 'application/json' };
      const boundary = '-------navinbackup' + Date.now();
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;

      const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Drive upload failed (${uploadRes.status}): ${errText}`);
      }

      const uploaded = await uploadRes.json();
      const now = Date.now();
      await db.updateSettings({ googleDrive: { ...settings.googleDrive, accessToken: token, lastBackup: now } });
      await BackupManager._logHistory({ type: 'Google Drive', filename: uploaded.name, status: 'Successful', taskCount: backup.meta.taskCount });
      return { ok: true, filename: uploaded.name, date: now };
    } catch (e) {
      await BackupManager._logHistory({ type: 'Google Drive', filename: '—', status: 'Failed: ' + e.message, taskCount: 0 });
      return { ok: false, error: e.message };
    }
  },

  async listBackups() {
    if (!this.isConfigured()) return { ok: false, error: 'Google Drive is not configured.' };
    try {
      const token = await this._getValidToken();
      const settings = await db.getSettings();
      const q = encodeURIComponent(`'${settings.googleDrive.folderId}' in parents and trashed=false`);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,size)&orderBy=createdTime desc`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());
      return { ok: true, files: res.files || [] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async restoreFromDrive(fileId, mode = 'merge') {
    try {
      const token = await this._getValidToken();
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Could not download backup (${res.status})`);
      const data = await res.json();
      const validation = BackupManager.validate(data);
      if (!validation.valid) throw new Error(validation.errors.join(' '));
      await BackupManager.restore(data, mode);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
};
