/* ui.js — shared render helpers (task cards) and the Add/Edit Task modal.
   Used by app.js, calendar.js, tasks-view (in app.js), completed view. */

function priorityLabel(p) {
  return { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' }[p] || p;
}

function statusBadge(task) {
  if (task.status === 'completed') return `<span class="badge badge-done">✓ Completed</span>`;
  if (task.status === 'carried') return `<span class="badge badge-carried">🔄 Carried Forward</span>`;
  if (task.status === 'cancelled') return `<span class="badge badge-cancelled">Cancelled</span>`;
  return '';
}

function renderTaskCard(task, cat) {
  const isDone = task.status === 'completed';
  const meta = [];
  if (task.dueTime) meta.push(formatTime12(task.dueTime));
  if (task.estimatedDuration) meta.push(`${task.estimatedDuration} min`);
  if (task.location) meta.push(`📍 ${escapeHtml(task.location)}`);
  if (task.status === 'carried') meta.push(`from ${formatShortDate(task.originalDate)}`);

  return `
    <div class="task-card priority-${task.priority} ${isDone ? 'is-done' : ''}" data-id="${task.id}">
      <button class="task-check ${isDone ? 'checked' : ''}" data-action="toggle" aria-label="Mark complete">
        ${isDone ? '✓' : ''}
      </button>
      <div class="task-body" data-action="open">
        <div class="task-top">
          <span class="task-title">${escapeHtml(task.title)}</span>
          ${cat ? `<span class="cat-chip" style="background:${cat.color}22;color:${cat.color}">${escapeHtml(cat.name)}</span>` : ''}
        </div>
        ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          ${statusBadge(task)}
          ${meta.map(m => `<span class="meta-item">${m}</span>`).join('')}
        </div>
      </div>
      <button class="task-more" data-action="menu" aria-label="More options">⋮</button>
    </div>`;
}

/* --- Compact cards for the Today two-column layout --- */
function renderCompactTaskCard(task, cat) {
  const meta = [];
  if (task.dueTime) meta.push(formatTime12(task.dueTime));
  if (cat) meta.push(`<span class="cat-chip" style="background:${cat.color}22;color:${cat.color}">${escapeHtml(cat.name)}</span>`);
  if (task.status === 'carried') meta.push(`<span class="mini-carried-tag">🔄 carried</span>`);

  return `
    <div class="task-card-mini priority-${task.priority}" data-id="${task.id}" data-action="open">
      <button class="mini-check" data-action="toggle" aria-label="Mark complete"></button>
      <div class="mini-body">
        <div class="mini-title">${escapeHtml(task.title)}</div>
        <div class="mini-meta">${meta.join(' ')}</div>
      </div>
    </div>`;
}

function renderCompletedMiniCard(task, cat) {
  const meta = [];
  if (task.dueTime) meta.push(formatTime12(task.dueTime));
  if (cat) meta.push(escapeHtml(cat.name));

  return `
    <div class="task-card-done" data-id="${task.id}" data-action="open">
      <span class="done-tick">✓</span>
      <div class="mini-body">
        <div class="mini-title">${escapeHtml(task.title)}</div>
        <div class="mini-meta">${meta.join(' · ')}</div>
      </div>
    </div>`;
}

function bindCompactTaskEvents(container) {
  container.querySelectorAll('.task-card-mini').forEach(card => {
    const id = card.dataset.id;
    const checkBtn = card.querySelector('[data-action="toggle"]');
    checkBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await TaskManager.complete(id);
      App.refreshCurrentView();
    });
    card.addEventListener('click', () => TaskModal.open(id));
  });
  container.querySelectorAll('.task-card-done').forEach(card => {
    card.addEventListener('click', () => TaskModal.open(card.dataset.id));
  });
}

function bindTaskCardEvents(container) {
  container.querySelectorAll('.task-card').forEach(card => {
    const id = card.dataset.id;
    const checkBtn = card.querySelector('[data-action="toggle"]');
    const body = card.querySelector('[data-action="open"]');
    const moreBtn = card.querySelector('[data-action="menu"]');

    checkBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const task = await TaskManager.getById(id);
      if (task.status === 'completed') await TaskManager.uncomplete(id);
      else await TaskManager.complete(id);
      App.refreshCurrentView();
    });

    body.addEventListener('click', () => TaskModal.open(id));

    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      TaskMenu.open(id, moreBtn);
    });
  });
}

/* --- Quick action menu (Complete / Edit / Cancel / Delete) --- */
const TaskMenu = {
  open(taskId, anchorEl) {
    this.close();
    const menu = document.createElement('div');
    menu.className = 'task-quick-menu';
    menu.innerHTML = `
      <button data-act="edit">Edit</button>
      <button data-act="cancel">Cancel task</button>
      <button data-act="delete">Delete</button>
    `;
    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.left = `${Math.max(8, rect.right - 160 + window.scrollX)}px`;

    menu.querySelector('[data-act="edit"]').addEventListener('click', () => { this.close(); TaskModal.open(taskId); });
    menu.querySelector('[data-act="cancel"]').addEventListener('click', async () => {
      this.close();
      if (confirm('Cancel this task? It will be kept in your records but marked cancelled.')) {
        await TaskManager.cancel(taskId);
        App.refreshCurrentView();
      }
    });
    menu.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      this.close();
      if (confirm('Permanently delete this task? This cannot be undone.')) {
        await TaskManager.delete(taskId);
        App.refreshCurrentView();
      }
    });

    setTimeout(() => document.addEventListener('click', this._outsideHandler = () => this.close(), { once: true }), 0);
  },
  close() {
    document.querySelectorAll('.task-quick-menu').forEach(m => m.remove());
  }
};

/* --- Add / Edit Task modal --- */
const TaskModal = {
  editingId: null,

  async open(taskId = null) {
    this.editingId = taskId;
    const task = taskId ? await TaskManager.getById(taskId) : null;
    const categories = await CategoryManager.getAll();
    const settings = await db.getSettings();

    const modal = document.getElementById('modal-root');
    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${task ? 'Edit Task' : 'New Task'}</h2>
            <button class="icon-btn" id="modal-close" aria-label="Close">✕</button>
          </div>
          <form id="task-form" class="modal-form">
            <label class="field">
              <span>Task title</span>
              <input type="text" name="title" required maxlength="200" value="${task ? escapeHtml(task.title) : ''}" placeholder="e.g. Call customer regarding renewal">
            </label>

            <label class="field">
              <span>Description / notes</span>
              <textarea name="description" rows="2" placeholder="Optional details">${task ? escapeHtml(task.description) : ''}</textarea>
            </label>

            <div class="field-row">
              <label class="field">
                <span>Date</span>
                <input type="date" name="dueDate" value="${task ? task.dueDate : todayKey()}" required>
              </label>
              <label class="field">
                <span>Time</span>
                <input type="time" name="dueTime" value="${task && task.dueTime ? task.dueTime : ''}">
              </label>
            </div>

            <div class="field-row">
              <label class="field">
                <span>Priority</span>
                <select name="priority">
                  <option value="high" ${task && task.priority === 'high' ? 'selected' : ''}>🔴 High</option>
                  <option value="medium" ${!task || task.priority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
                  <option value="low" ${task && task.priority === 'low' ? 'selected' : ''}>🟢 Low</option>
                </select>
              </label>
              <label class="field">
                <span>Category</span>
                <select name="category">
                  ${categories.map(c => `<option value="${c.id}" ${task ? (task.category === c.id ? 'selected' : '') : (c.id === 'cat-other' ? '' : '')}>${escapeHtml(c.name)}</option>`).join('')}
                </select>
              </label>
            </div>

            <div class="field-row">
              <label class="field">
                <span>Reminder</span>
                <select name="reminder">
                  <option value="">None</option>
                  <option value="0">At task time</option>
                  <option value="5">5 minutes before</option>
                  <option value="10">10 minutes before</option>
                  <option value="15">15 minutes before</option>
                  <option value="30">30 minutes before</option>
                  <option value="60">1 hour before</option>
                  <option value="1440">1 day before</option>
                </select>
              </label>
              <label class="field checkbox-field">
                <input type="checkbox" name="alarmEnabled" ${task && task.alarmEnabled ? 'checked' : ''}>
                <span>Also ring alarm</span>
              </label>
            </div>

            <label class="field">
              <span>Repeat</span>
              <select name="repeatType" id="repeat-type">
                <option value="">None</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Every weekday</option>
                <option value="weekly">Weekly (choose days)</option>
                <option value="monthly">Monthly (same date)</option>
                <option value="custom_interval">Custom interval</option>
              </select>
            </label>
            <div id="repeat-days-row" class="weekday-picker" style="display:none">
              ${['Su','Mo','Tu','We','Th','Fr','Sa'].map((d, i) => `<label><input type="checkbox" name="repeatDay" value="${i}"><span>${d}</span></label>`).join('')}
            </div>
            <div id="repeat-interval-row" class="field-row" style="display:none">
              <label class="field">
                <span>Repeat every (days)</span>
                <input type="number" name="repeatInterval" min="2" max="365" value="2">
              </label>
            </div>

            <div class="field-row">
              <label class="field">
                <span>Estimated duration (min)</span>
                <input type="number" name="estimatedDuration" min="0" step="5" value="${task && task.estimatedDuration ? task.estimatedDuration : ''}" placeholder="${settings.defaultDuration}">
              </label>
              <label class="field">
                <span>Location</span>
                <input type="text" name="location" value="${task ? escapeHtml(task.location || '') : ''}" placeholder="Optional">
              </label>
            </div>

            <label class="field">
              <span>Tags (comma separated)</span>
              <input type="text" name="tags" value="${task ? (task.tags || []).join(', ') : ''}" placeholder="e.g. urgent, renewal">
            </label>

            <div class="modal-actions">
              ${task ? '<button type="button" id="modal-delete" class="btn btn-danger-ghost">Delete</button>' : '<span></span>'}
              <button type="submit" class="btn btn-primary">${task ? 'Save Changes' : 'Add Task'}</button>
            </div>
          </form>
        </div>
      </div>`;

    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

    const repeatSelect = document.getElementById('repeat-type');
    repeatSelect.addEventListener('change', () => {
      document.getElementById('repeat-days-row').style.display = repeatSelect.value === 'weekly' ? 'flex' : 'none';
      document.getElementById('repeat-interval-row').style.display = repeatSelect.value === 'custom_interval' ? 'flex' : 'none';
    });
    if (task && task.recurrence) {
      repeatSelect.value = task.recurrence.type;
      repeatSelect.dispatchEvent(new Event('change'));
      if (task.recurrence.days) {
        task.recurrence.days.forEach(d => {
          const cb = overlay.querySelector(`input[name="repeatDay"][value="${d}"]`);
          if (cb) cb.checked = true;
        });
      }
      if (task.recurrence.interval) {
        overlay.querySelector('input[name="repeatInterval"]').value = task.recurrence.interval;
      }
    }

    if (task) {
      const reminderSelect = overlay.querySelector('select[name="reminder"]');
      reminderSelect.value = task.reminder != null ? String(task.reminder) : '';
    }

    document.getElementById('task-form').addEventListener('submit', (e) => this._submit(e));
    if (task) {
      document.getElementById('modal-delete').addEventListener('click', async () => {
        if (confirm('Permanently delete this task?')) {
          await TaskManager.delete(task.id);
          this.close();
          App.refreshCurrentView();
        }
      });
    }

    document.getElementById('modal-root').classList.add('open');
  },

  close() {
    document.getElementById('modal-root').classList.remove('open');
    document.getElementById('modal-root').innerHTML = '';
    this.editingId = null;
  },

  async _submit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const repeatType = fd.get('repeatType');
    let recurrence = null;
    if (repeatType === 'weekly') {
      const days = fd.getAll('repeatDay').map(Number);
      recurrence = { type: 'weekly', days };
    } else if (repeatType === 'custom_interval') {
      recurrence = { type: 'custom_interval', interval: Number(fd.get('repeatInterval')) || 2, startDate: fd.get('dueDate') };
    } else if (repeatType) {
      recurrence = { type: repeatType };
    }

    const input = {
      title: fd.get('title'),
      description: fd.get('description'),
      dueDate: fd.get('dueDate'),
      dueTime: fd.get('dueTime') || null,
      priority: fd.get('priority'),
      category: fd.get('category'),
      reminder: fd.get('reminder') ? Number(fd.get('reminder')) : null,
      alarmEnabled: fd.get('alarmEnabled') === 'on',
      estimatedDuration: fd.get('estimatedDuration') ? Number(fd.get('estimatedDuration')) : null,
      location: fd.get('location'),
      tags: fd.get('tags') ? fd.get('tags').split(',').map(t => t.trim()).filter(Boolean) : [],
      recurrence
    };

    if (this.editingId) {
      await TaskManager.update(this.editingId, input);
    } else {
      await TaskManager.create(input);
    }
    this.close();
    App.refreshCurrentView();
    NotificationManager.scheduleAllReminders();
  }
};
       
