/* backup.js — export full DB to a JSON file, and restore/merge from one.
   Also records every backup (local or Drive) into the backupHistory store. */

const BackupManager = {

  async buildBackupObject() {
    const [tasks, categories, settings, alarms] = await Promise.all([
      db.getAll(STORE_TASKS),
      db.getAll(STORE_CATEGORIES),
      db.getSettings(),
      db.getAll(STORE_ALARMS)
    ]);
    return {
      meta: {
        app: 'Navin Day Planner',
        appVersion: APP_VERSION,
        dbVersion: DB_VERSION,
        backupDate: new Date().toISOString(),
        taskCount: tasks.length,
        completedCount: tasks.filter(t => t.status === 'completed').length
      },
      tasks,
      categories,
      settings,
      alarms
    };
  },

  async exportLocal() {
    const backup = await this.buildBackupObject();
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `Navin-Day-Planner-Backup-${todayKey()}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    await this._logHistory({ type: 'Local JSON', filename, status: 'Successful', taskCount: backup.meta.taskCount });
    return { filename, backup };
  },

  validate(parsed) {
    const errors = [];
    if (!parsed || typeof parsed !== 'object') errors.push('File is not a valid JSON object.');
    else {
      if (!parsed.meta) errors.push('Missing backup metadata.');
      if (!Array.isArray(parsed.tasks)) errors.push('Missing or invalid tasks list.');
      if (!Array.isArray(parsed.categories)) errors.push('Missing or invalid categories list.');
      if (parsed.meta && parsed.meta.dbVersion && parsed.meta.dbVersion > DB_VERSION) {
        errors.push('This backup was made with a newer app version and may not be fully compatible.');
      }
    }
    return { valid: errors.length === 0, errors };
  },

  async readFile(file) {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { valid: false, errors: ['File is not valid JSON.'] };
    }
    const validation = this.validate(parsed);
    return { ...validation, data: parsed };
  },

  async restore(data, mode = 'merge') {
    if (mode === 'replace') {
      await db.clear(STORE_TASKS);
      await db.clear(STORE_CATEGORIES);
      await db.clear(STORE_ALARMS);
    }

    if (Array.isArray(data.categories)) {
      await db.putMany(STORE_CATEGORIES, data.categories);
    }
    if (Array.isArray(data.tasks)) {
      if (mode === 'merge') {
        // Use task IDs to avoid duplicates: put() overwrites same-id records,
        // and any task whose id doesn't yet exist locally is simply added.
        await db.putMany(STORE_TASKS, data.tasks);
      } else {
        await db.putMany(STORE_TASKS, data.tasks);
      }
    }
    if (Array.isArray(data.alarms)) {
      await db.putMany(STORE_ALARMS, data.alarms);
    }
    if (data.settings && mode === 'replace') {
      await db.put(STORE_SETTINGS, { ...data.settings, id: 'settings' });
    }

    await this._logHistory({
      type: 'Restore (' + mode + ')',
      filename: '—',
      status: 'Successful',
      taskCount: (data.tasks || []).length
    });
  },

  async _logHistory(entry) {
    const record = {
      id: uid('bh'),
      date: Date.now(),
      ...entry
    };
    await db.put(STORE_BACKUP_HISTORY, record);
    return record;
  },

  async getHistory() {
    const all = await db.getAll(STORE_BACKUP_HISTORY);
    return all.sort((a, b) => b.date - a.date);
  }
};
