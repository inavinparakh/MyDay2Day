/* tasks.js — task business logic: create/update/complete/cancel, carry-forward, recurrence.
   Nothing here touches the DOM. app.js reads from here and renders. */

const TaskManager = {

  async create(input) {
    const now = Date.now();
    const task = {
      id: uid('task'),
      title: input.title.trim(),
      description: input.description || '',
      category: input.category || 'cat-other',
      tags: input.tags || [],
      originalDate: input.dueDate || todayKey(),
      dueDate: input.dueDate || todayKey(),
      dueTime: input.dueTime || null,
      priority: input.priority || 'medium',
      status: 'pending',
      reminder: input.reminder ?? null,
      alarmEnabled: !!input.alarmEnabled,
      estimatedDuration: input.estimatedDuration || null,
      location: input.location || '',
      recurrence: input.recurrence || null,
      recurrenceParentId: input.recurrenceParentId || null,
      generatedDates: input.recurrence ? [] : undefined,
      createdAt: now,
      completedAt: null,
      cancelledAt: null,
      carryForwardCount: 0,
      lastCarryForwardDate: null,
      notifiedReminderAt: null
    };
    await db.put(STORE_TASKS, task);

    // A recurring template is metadata, not an actionable item itself — if
    // its pattern matches today, generate today's real instance right away
    // instead of waiting for the next daily maintenance run.
    if (task.recurrence) {
      await this._maybeGenerateInstance(task, todayKey());
    }
    return task;
  },

  _isTemplate(t) {
    return !!t.recurrence && !t.recurrenceParentId;
  },

  async _maybeGenerateInstance(tmpl, dateKey) {
    if ((tmpl.generatedDates || []).includes(dateKey)) return null;
    if (!this._recurrenceMatchesDate(tmpl.recurrence, dateKey)) return null;

    const instance = await this.create({
      title: tmpl.title,
      description: tmpl.description,
      category: tmpl.category,
      tags: tmpl.tags,
      dueDate: dateKey,
      dueTime: tmpl.dueTime,
      priority: tmpl.priority,
      reminder: tmpl.reminder,
      alarmEnabled: tmpl.alarmEnabled,
      estimatedDuration: tmpl.estimatedDuration,
      location: tmpl.location,
      recurrence: null,
      recurrenceParentId: tmpl.id
    });

    const fresh = await db.get(STORE_TASKS, tmpl.id);
    fresh.generatedDates = [...(fresh.generatedDates || []), dateKey];
    await db.put(STORE_TASKS, fresh);
    return instance;
  },

  async update(id, patch) {
    const task = await db.get(STORE_TASKS, id);
    if (!task) throw new Error('Task not found');
    const updated = { ...task, ...patch };
    await db.put(STORE_TASKS, updated);
    return updated;
  },

  async complete(id) {
    const task = await db.get(STORE_TASKS, id);
    if (!task) throw new Error('Task not found');
    const now = Date.now();
    task.status = 'completed';
    task.completedAt = now;
    await db.put(STORE_TASKS, task);
    return task;
  },

  async uncomplete(id) {
    const task = await db.get(STORE_TASKS, id);
    if (!task) throw new Error('Task not found');
    task.status = task.dueDate < todayKey() ? 'carried' : 'pending';
    task.completedAt = null;
    await db.put(STORE_TASKS, task);
    return task;
  },

  async cancel(id) {
    const task = await db.get(STORE_TASKS, id);
    if (!task) throw new Error('Task not found');
    task.status = 'cancelled';
    task.cancelledAt = Date.now();
    await db.put(STORE_TASKS, task);
    return task;
  },

  async delete(id) {
    await db.delete(STORE_TASKS, id);
  },

  async getAll() {
    return db.getAll(STORE_TASKS);
  },

  async getById(id) {
    return db.get(STORE_TASKS, id);
  },

  async getForDate(dateKey) {
    const all = await this.getAll();
    return all.filter(t => t.dueDate === dateKey && t.status !== 'cancelled' && !this._isTemplate(t));
  },

  async getPendingAndCarried() {
    const all = await this.getAll();
    return all.filter(t => (t.status === 'pending' || t.status === 'carried') && !this._isTemplate(t));
  },

  async getCompleted() {
    const all = await this.getAll();
    return all.filter(t => t.status === 'completed').sort((a, b) => b.completedAt - a.completedAt);
  },

  /* --- Carry-forward engine ---
     Runs once per calendar day. Any task with status pending/carried whose
     dueDate is before today gets its dueDate moved to today, status set to
     'carried', and carryForwardCount incremented. originalDate never changes.
     Recurring-task INSTANCES that were never completed also carry forward
     like any other task — the recurrence template itself is untouched. */
  async runCarryForward() {
    const settings = await db.getSettings();
    if (!settings.carryForwardEnabled) return { moved: 0 };

    const today = todayKey();
    if (settings.lastCarryForwardRun === today) return { moved: 0 };

    const all = await this.getAll();
    let moved = 0;
    for (const task of all) {
      const isOpen = task.status === 'pending' || task.status === 'carried';
      const isOverdue = isBefore(task.dueDate, today);
      const isRecurrenceTemplate = !!task.recurrence && !task.recurrenceParentId;
      if (isOpen && isOverdue && !isRecurrenceTemplate) {
        task.dueDate = today;
        task.status = 'carried';
        task.carryForwardCount = (task.carryForwardCount || 0) + 1;
        task.lastCarryForwardDate = today;
        await db.put(STORE_TASKS, task);
        moved++;
      }
    }

    await db.updateSettings({ lastCarryForwardRun: today });
    return { moved };
  },

  /* --- Recurrence engine ---
     A recurring task is stored once as a "template" (recurrence != null,
     recurrenceParentId == null, status stays 'pending' forever, never shown
     directly). Each day, for every template whose pattern matches today and
     that has not already generated an instance for today, we create one real
     task instance (recurrenceParentId = template.id). generatedDates on the
     template prevents duplicate generation if this runs more than once. */
  async runRecurrenceGeneration() {
    const all = await this.getAll();
    const templates = all.filter(t => t.recurrence && !t.recurrenceParentId);
    const today = todayKey();
    let created = 0;

    for (const tmpl of templates) {
      const instance = await this._maybeGenerateInstance(tmpl, today);
      if (instance) created++;
    }
    return { created };
  },

  _recurrenceMatchesDate(recurrence, dateKey) {
    const d = parseDateKey(dateKey);
    const dow = d.getDay(); // 0=Sun
    switch (recurrence.type) {
      case 'daily':
        return true;
      case 'weekdays':
        return dow >= 1 && dow <= 5;
      case 'weekly':
        return (recurrence.days || []).includes(dow);
      case 'monthly':
        return d.getDate() === (recurrence.dayOfMonth || d.getDate());
      case 'custom_days':
        return (recurrence.days || []).includes(dow);
      case 'custom_interval': {
        if (!recurrence.startDate || !recurrence.interval) return false;
        const start = parseDateKey(recurrence.startDate);
        const diffDays = Math.round((d - start) / 86400000);
        return diffDays >= 0 && diffDays % recurrence.interval === 0;
      }
      default:
        return false;
    }
  },

  async runDailyMaintenance() {
    await this.runCarryForward();
    await this.runRecurrenceGeneration();
  },

  async stats(dateKey = todayKey()) {
    const all = await this.getAll();
    const todays = all.filter(t => t.dueDate === dateKey && t.status !== 'cancelled' && t.status !== 'completed' && !this._isTemplate(t));
    const highPriority = todays.filter(t => t.priority === 'high');
    const carried = todays.filter(t => t.status === 'carried');
    const completedToday = all.filter(t => t.status === 'completed' && t.completedAt && toDateKey(new Date(t.completedAt)) === dateKey);
    return {
      pending: todays.length,
      highPriority: highPriority.length,
      carriedForward: carried.length,
      completed: completedToday.length
    };
  },

  async search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all = await this.getAll();
    return all.filter(t => !this._isTemplate(t) && (
      t.title.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.tags || []).some(tag => tag.toLowerCase().includes(q)) ||
      (t.location || '').toLowerCase().includes(q)
    ));
  }
};
