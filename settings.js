/* settings.js — renders the Settings tab and wires up every preference,
   category editor, backup/restore flow, and Google Drive connection. */

const SettingsView = {
  async render() {
    const settings = await db.getSettings();
    const categories = await CategoryManager.getAll();
    const history = await BackupManager.getHistory();
    const container = document.getElementById('settings-view');

    container.innerHTML = `
      <div class="settings-section">
        <h3>Profile</h3>
        <label class="field">
          <span>Your name</span>
          <input type="text" id="set-name" value="${escapeHtml(settings.name || '')}" placeholder="e.g. Navin">
        </label>
      </div>

      <div class="settings-section">
        <h3>Task defaults</h3>
        <label class="field">
          <span>Default reminder</span>
          <select id="set-default-reminder">
            <option value="" ${settings.defaultReminder == null ? 'selected' : ''}>None</option>
            <option value="5" ${settings.defaultReminder === 5 ? 'selected' : ''}>5 minutes before</option>
            <option value="10" ${settings.defaultReminder === 10 ? 'selected' : ''}>10 minutes before</option>
            <option value="15" ${settings.defaultReminder === 15 ? 'selected' : ''}>15 minutes before</option>
            <option value="30" ${settings.defaultReminder === 30 ? 'selected' : ''}>30 minutes before</option>
            <option value="60" ${settings.defaultReminder === 60 ? 'selected' : ''}>1 hour before</option>
          </select>
        </label>
        <label class="field">
          <span>Default task duration (minutes)</span>
          <input type="number" id="set-default-duration" value="${settings.defaultDuration}" min="0" step="5">
        </label>
        <label class="field">
          <span>Start of day</span>
          <select id="set-start-hour">
            ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${settings.startOfDayHour === h ? 'selected' : ''}>${formatTime12(String(h).padStart(2,'0')+':00')}</option>`).join('')}
          </select>
        </label>
        <label class="field checkbox-field">
          <input type="checkbox" id="set-carry-forward" ${settings.carryForwardEnabled ? 'checked' : ''}>
          <span>Automatically carry forward unfinished tasks</span>
        </label>
      </div>

      <div class="settings-section">
        <h3>Notifications</h3>
        <div id="notif-status" class="status-pill">Checking…</div>
        <button class="btn btn-secondary" id="set-enable-notif">Enable Notifications</button>
      </div>

      <div class="settings-section">
        <h3>Appearance</h3>
        <div class="seg-control" id="theme-control">
          <button data-theme="light" class="${settings.theme === 'light' ? 'active' : ''}">Light</button>
          <button data-theme="dark" class="${settings.theme === 'dark' ? 'active' : ''}">Dark</button>
          <button data-theme="system" class="${settings.theme === 'system' ? 'active' : ''}">System</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Categories</h3>
        <div id="category-list" class="category-list">
          ${categories.map(c => `
            <div class="category-row" data-id="${c.id}">
              <span class="cat-dot" style="background:${c.color}"></span>
              <span class="category-name">${escapeHtml(c.name)}</span>
              ${!c.isDefault ? `<button class="icon-btn" data-action="delete-cat">🗑</button>` : ''}
            </div>`).join('')}
        </div>
        <form id="add-category-form" class="inline-add-form">
          <input type="text" id="new-cat-name" placeholder="New category name" required>
          <input type="color" id="new-cat-color" value="#5C6773">
          <button type="submit" class="btn btn-secondary">Add</button>
        </form>
      </div>

      <div class="settings-section">
        <h3>Alarms</h3>
        <div id="alarms-list" class="alarms-list"></div>
        <button class="btn btn-secondary" id="add-alarm-btn">+ Add Alarm</button>
      </div>

      <div class="settings-section">
        <h3>Backup &amp; Restore</h3>
        <div class="button-row">
          <button class="btn btn-primary" id="btn-backup-local">☁️ Backup Data</button>
          <button class="btn btn-secondary" id="btn-restore-local">♻️ Restore Data</button>
        </div>
        <input type="file" id="restore-file-input" accept="application/json" style="display:none">
      </div>

      <div class="settings-section">
        <h3>Google Drive Backup</h3>
        <div id="gdrive-status" class="status-pill">${settings.googleDrive?.connected ? `Connected as ${escapeHtml(settings.googleDrive.email || '')}` : 'Not connected'}</div>
        ${!DriveBackup.isConfigured() ? `<p class="hint-text">Google Drive is not configured yet. Add your OAuth Client ID to <code>js/config.js</code> to enable this — see the comments in that file for exact steps.</p>` : ''}
        <div class="button-row">
          ${settings.googleDrive?.connected ? `
            <button class="btn btn-primary" id="btn-drive-backup">Backup Now</button>
            <button class="btn btn-secondary" id="btn-drive-restore">Restore From Drive</button>
            <button class="btn btn-danger-ghost" id="btn-drive-disconnect">Disconnect</button>
          ` : `
            <button class="btn btn-primary" id="btn-drive-connect" ${!DriveBackup.isConfigured() ? 'disabled' : ''}>Connect Google Account</button>
          `}
        </div>
        <div class="hint-text">Last backup: ${settings.googleDrive?.lastBackup ? formatTimestamp(settings.googleDrive.lastBackup) : 'Never'}</div>
      </div>

      <div class="settings-section">
        <h3>Backup History</h3>
        <div class="backup-history">
          ${history.length === 0 ? '<div class="empty-state">No backups yet.</div>' : history.slice(0, 15).map(h => `
            <div class="backup-history-row">
              <div>
                <div class="bh-filename">${escapeHtml(h.filename)}</div>
                <div class="bh-meta">${h.type} · ${formatTimestamp(h.date)} · ${h.taskCount} tasks</div>
              </div>
              <span class="bh-status ${h.status.startsWith('Successful') ? 'ok' : 'error'}">${escapeHtml(h.status)}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="settings-section">
        <h3>About</h3>
        <p class="hint-text">Navin Day Planner v${APP_VERSION} · Database v${DB_VERSION}</p>
      </div>
    `;

    this._bind(settings);
    NotificationManager.updateStatusUI();
    AlarmUI.render();
  },

  _bind(settings) {
    const save = debounce(async (patch) => { await db.updateSettings(patch); }, 300);

    document.getElementById('set-name').addEventListener('input', (e) => save({ name: e.target.value }));
    document.getElementById('set-default-reminder').addEventListener('change', (e) => save({ defaultReminder: e.target.value ? Number(e.target.value) : null }));
    document.getElementById('set-default-duration').addEventListener('input', (e) => save({ defaultDuration: Number(e.target.value) || 0 }));
    document.getElementById('set-start-hour').addEventListener('change', (e) => save({ startOfDayHour: Number(e.target.value) }));
    document.getElementById('set-carry-forward').addEventListener('change', (e) => save({ carryForwardEnabled: e.target.checked }));
    document.getElementById('set-enable-notif').addEventListener('click', () => NotificationManager.requestPermission());

    document.querySelectorAll('#theme-control button').forEach(btn => {
      btn.addEventListener('click', async () => {
        await db.updateSettings({ theme: btn.dataset.theme });
        ThemeManager.apply(btn.dataset.theme);
        this.render();
      });
    });

    document.getElementById('add-category-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-cat-name').value;
      const color = document.getElementById('new-cat-color').value;
      if (!name.trim()) return;
      await CategoryManager.add(name, color);
      this.render();
    });
    document.querySelectorAll('[data-action="delete-cat"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const row = e.target.closest('.category-row');
        if (confirm('Delete this category? Tasks using it will move to "Other".')) {
          await CategoryManager.delete(row.dataset.id);
          this.render();
        }
      });
    });

    document.getElementById('add-alarm-btn').addEventListener('click', () => AlarmUI.openAddForm());

    document.getElementById('btn-backup-local').addEventListener('click', async () => {
      await BackupManager.exportLocal();
      this.render();
    });
    document.getElementById('btn-restore-local').addEventListener('click', () => {
      document.getElementById('restore-file-input').click();
    });
    document.getElementById('restore-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const result = await BackupManager.readFile(file);
      if (!result.valid) {
        alert('This backup file could not be used:\n' + result.errors.join('\n'));
        return;
      }
      RestoreConfirmModal.open(result.data);
      e.target.value = '';
    });

    if (settings.googleDrive?.connected) {
      document.getElementById('btn-drive-backup').addEventListener('click', async () => {
        const btn = document.getElementById('btn-drive-backup');
        btn.disabled = true; btn.textContent = 'Backing up…';
        const res = await DriveBackup.backupNow();
        if (!res.ok) alert('Backup failed: ' + res.error);
        this.render();
      });
      document.getElementById('btn-drive-restore').addEventListener('click', async () => {
        const res = await DriveBackup.listBackups();
        if (!res.ok) { alert(res.error); return; }
        DriveRestoreModal.open(res.files);
      });
      document.getElementById('btn-drive-disconnect').addEventListener('click', async () => {
        if (confirm('Disconnect Google Drive? Local data is not affected.')) {
          await DriveBackup.disconnect();
          this.render();
        }
      });
    } else {
      const connectBtn = document.getElementById('btn-drive-connect');
      connectBtn.addEventListener('click', async () => {
        connectBtn.disabled = true; connectBtn.textContent = 'Connecting…';
        const res = await DriveBackup.connect();
        if (!res.ok) alert(res.error);
        this.render();
      });
    }
  }
};

const RestoreConfirmModal = {
  open(data) {
    const modal = document.getElementById('modal-root');
    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header"><h2>Restore Backup</h2><button class="icon-btn" id="modal-close">✕</button></div>
          <div class="modal-form">
            <p>Backup date: <strong>${formatTimestamp(new Date(data.meta.backupDate).getTime())}</strong></p>
            <p>Tasks in backup: <strong>${data.meta.taskCount}</strong> (${data.meta.completedCount} completed)</p>
            <p class="hint-text">Choose how to apply this backup:</p>
            <div class="modal-actions" style="flex-direction:column;gap:10px;align-items:stretch">
              <button class="btn btn-primary" id="restore-merge">Merge with existing data</button>
              <button class="btn btn-danger-ghost" id="restore-replace">Replace all existing data</button>
            </div>
          </div>
        </div>
      </div>`;
    document.getElementById('modal-close').addEventListener('click', () => TaskModal.close());
    document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') TaskModal.close(); });
    document.getElementById('restore-merge').addEventListener('click', async () => {
      await BackupManager.restore(data, 'merge');
      TaskModal.close();
      SettingsView.render();
      App.refreshCurrentView();
    });
    document.getElementById('restore-replace').addEventListener('click', async () => {
      if (confirm('This will permanently replace all current tasks and categories. Continue?')) {
        await BackupManager.restore(data, 'replace');
        TaskModal.close();
        SettingsView.render();
        App.refreshCurrentView();
      }
    });
    document.getElementById('modal-root').classList.add('open');
  }
};

const DriveRestoreModal = {
  open(files) {
    const modal = document.getElementById('modal-root');
    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header"><h2>Restore From Drive</h2><button class="icon-btn" id="modal-close">✕</button></div>
          <div class="modal-form">
            ${files.length === 0 ? '<p>No backups found in Drive yet.</p>' : files.map(f => `
              <div class="drive-file-row" data-id="${f.id}">
                <span>${escapeHtml(f.name)}</span>
                <button class="btn btn-secondary" data-id="${f.id}">Restore</button>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
    document.getElementById('modal-close').addEventListener('click', () => TaskModal.close());
    document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') TaskModal.close(); });
    modal.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Merge this backup into your current data?')) return;
        const res = await DriveBackup.restoreFromDrive(btn.dataset.id, 'merge');
        if (!res.ok) { alert('Restore failed: ' + res.error); return; }
        TaskModal.close();
        App.refreshCurrentView();
      });
    });
    document.getElementById('modal-root').classList.add('open');
  }
};

const ThemeManager = {
  apply(theme) {
    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  },
  async init() {
    const settings = await db.getSettings();
    this.apply(settings.theme);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
      const s = await db.getSettings();
      if (s.theme === 'system') this.apply('system');
    });
  }
};
