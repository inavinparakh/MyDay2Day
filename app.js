/* app.js — bootstraps the app, owns navigation state, renders the Today
   dashboard, the flat Tasks list, and Completed History. */

const App = {
  currentTab: 'today',
  completedFilter: 'today',

  async init() {
    await db.ready;
    await ThemeManager.init();
    await TaskManager.runDailyMaintenance();
    await NotificationManager.init();
    await AlarmEngine.init();
    this._bindNav();
    this._bindFab();
    this._bindSearch();
    this._tickClock();
    setInterval(() => this._tickClock(), 30000);
    await this.showTab('today');
    this._registerServiceWorker();
  },

  _bindNav() {
    document.querySelectorAll('.bottom-nav button').forEach(btn => {
      btn.addEventListener('click', () => this.showTab(btn.dataset.tab));
    });
  },

  _bindFab() {
    document.getElementById('fab-add').addEventListener('click', () => TaskModal.open());
  },

  _bindSearch() {
    const input = document.getElementById('global-search');
    input.addEventListener('input', debounce(async () => {
      const q = input.value.trim();
      if (!q) { this.refreshCurrentView(); return; }
      const results = await TaskManager.search(q);
      this._renderSearchResults(results, q);
    }, 250));
  },

  async _renderSearchResults(results, query) {
    const categories = await CategoryManager.getAll();
    const view = document.getElementById(`${this.currentTab}-view`) || document.getElementById('tasks-view');
    this.showTab('tasks', true);
    const container = document.getElementById('tasks-view');
    if (results.length === 0) {
      container.innerHTML = `<div class="empty-state">No results for "${escapeHtml(query)}".</div>`;
      return;
    }
    container.innerHTML = `<div class="task-list">${results.map(t => renderTaskCard(t, categories.find(c => c.id === t.category))).join('')}</div>`;
    bindTaskCardEvents(container);
  },

  _tickClock() {
    const el = document.getElementById('current-time');
    if (el) el.textContent = formatTime12(nowHHMM());
  },

  async showTab(tab, skipNavUpdate = false) {
    this.currentTab = tab;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${tab}-view`).classList.add('active');

    if (!skipNavUpdate) {
      document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      document.getElementById('global-search').value = '';
    }

    document.getElementById('fab-add').style.display = (tab === 'settings') ? 'none' : 'flex';

    if (tab === 'today') await this.renderToday();
    else if (tab === 'calendar') await CalendarView.render();
    else if (tab === 'tasks') await this.renderTasksList();
    else if (tab === 'completed') await this.renderCompleted();
    else if (tab === 'settings') await SettingsView.render();
  },

  async refreshCurrentView() {
    await this.showTab(this.currentTab, true);
  },

  async renderToday() {
    const today = todayKey();
    document.getElementById('today-date').textContent = formatFullDate(today);
    this._tickClock();

    const stats = await TaskManager.stats(today);
    document.getElementById('stat-high').textContent = stats.highPriority;
    document.getElementById('stat-pending').textContent = stats.pending;
    document.getElementById('stat-carried').textContent = stats.carriedForward;
    document.getElementById('stat-completed').textContent = stats.completed;

    const tasks = await TaskManager.getForDate(today);
    const categories = await CategoryManager.getAll();
    const timed = tasks.filter(t => t.dueTime && t.status !== 'completed').sort((a, b) => a.dueTime.localeCompare(b.dueTime));
    const anytime = tasks.filter(t => !t.dueTime && t.status !== 'completed');
    const done = tasks.filter(t => t.status === 'completed');

    const container = document.getElementById('today-timeline');
    if (tasks.length === 0) {
      container.innerHTML = `<div class="empty-state">Nothing planned for today yet. Tap + to add your first task.</div>`;
      return;
    }

    let html = '';
    if (timed.length || anytime.length) {
      html += '<div class="day-timeline">';
      timed.forEach(t => { html += renderTimelineRow(t, categories); });
      if (anytime.length) {
        html += `<div class="timeline-section-label">Anytime</div>`;
        anytime.forEach(t => { html += renderTimelineRow(t, categories); });
      }
      html += '</div>';
    }
    if (done.length) {
      html += `<div class="timeline-section-label">Completed today</div><div class="task-list">`;
      done.forEach(t => { html += renderTaskCard(t, categories.find(c => c.id === t.category)); });
      html += '</div>';
    }
    container.innerHTML = html;
    bindTaskCardEvents(container);
  },

  async renderTasksList() {
    const tasks = (await TaskManager.getPendingAndCarried()).sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueTime && b.dueTime) return a.dueTime.localeCompare(b.dueTime);
      return a.dueTime ? -1 : 1;
    });
    const categories = await CategoryManager.getAll();
    const container = document.getElementById('tasks-view');

    if (tasks.length === 0) {
      container.innerHTML = `<div class="empty-state">No pending tasks. Tap + to add one.</div>`;
      return;
    }

    const grouped = {};
    for (const t of tasks) {
      (grouped[t.dueDate] = grouped[t.dueDate] || []).push(t);
    }

    let html = '';
    for (const dateKey of Object.keys(grouped).sort()) {
      html += `<div class="date-group-label">${formatDateLabel(dateKey)}</div><div class="task-list">`;
      grouped[dateKey].forEach(t => { html += renderTaskCard(t, categories.find(c => c.id === t.category)); });
      html += '</div>';
    }
    container.innerHTML = html;
    bindTaskCardEvents(container);
  },

  async renderCompleted() {
    const container = document.getElementById('completed-view');
    container.innerHTML = `
      <div class="completed-toolbar">
        <div class="seg-control" id="completed-filter">
          <button data-f="today" class="${this.completedFilter === 'today' ? 'active' : ''}">Today</button>
          <button data-f="yesterday" class="${this.completedFilter === 'yesterday' ? 'active' : ''}">Yesterday</button>
          <button data-f="week" class="${this.completedFilter === 'week' ? 'active' : ''}">Week</button>
          <button data-f="month" class="${this.completedFilter === 'month' ? 'active' : ''}">Month</button>
          <button data-f="all" class="${this.completedFilter === 'all' ? 'active' : ''}">All</button>
        </div>
      </div>
      <div id="completed-list"></div>`;

    container.querySelectorAll('#completed-filter button').forEach(btn => {
      btn.addEventListener('click', () => { this.completedFilter = btn.dataset.f; this.renderCompleted(); });
    });

    const all = await TaskManager.getCompleted();
    const categories = await CategoryManager.getAll();
    const today = todayKey();
    const filtered = all.filter(t => {
      const d = toDateKey(new Date(t.completedAt));
      if (this.completedFilter === 'today') return d === today;
      if (this.completedFilter === 'yesterday') return d === addDays(today, -1);
      if (this.completedFilter === 'week') return d >= addDays(today, -7);
      if (this.completedFilter === 'month') return d >= addDays(today, -30);
      return true;
    });

    const list = document.getElementById('completed-list');
    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty-state">No completed tasks in this range.</div>`;
      return;
    }

    const grouped = {};
    for (const t of filtered) {
      const d = toDateKey(new Date(t.completedAt));
      (grouped[d] = grouped[d] || []).push(t);
    }

    let html = '';
    for (const dateKey of Object.keys(grouped).sort().reverse()) {
      html += `<div class="date-group-label">${formatFullDate(dateKey).toUpperCase()}</div>`;
      grouped[dateKey].forEach(t => {
        const cat = categories.find(c => c.id === t.category);
        html += `
          <div class="completed-row" data-id="${t.id}">
            <span>✓ ${escapeHtml(t.title)}</span>
            <span class="completed-time">${formatTime12(new Date(t.completedAt).toTimeString().slice(0,5))}</span>
          </div>`;
      });
    }
    list.innerHTML = html;
    list.querySelectorAll('.completed-row').forEach(row => {
      row.addEventListener('click', () => TaskModal.open(row.dataset.id));
    });
  },

  async _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('service-worker.js');
      } catch (e) {
        console.warn('Service worker registration failed (this is expected if opened via file://):', e.message);
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
