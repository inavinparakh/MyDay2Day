/* calendar.js — Day / Week / Month calendar views. Renders into #calendar-view. */

const CalendarView = {
  mode: 'day', // 'day' | 'week' | 'month'
  anchorDate: todayKey(),

  async render() {
    const container = document.getElementById('calendar-view');
    container.innerHTML = `
      <div class="cal-toolbar">
        <div class="seg-control" role="tablist">
          <button data-mode="day" class="${this.mode === 'day' ? 'active' : ''}">Day</button>
          <button data-mode="week" class="${this.mode === 'week' ? 'active' : ''}">Week</button>
          <button data-mode="month" class="${this.mode === 'month' ? 'active' : ''}">Month</button>
        </div>
        <div class="cal-nav">
          <button class="icon-btn" id="cal-prev" aria-label="Previous">‹</button>
          <span id="cal-label" class="cal-label"></span>
          <button class="icon-btn" id="cal-next" aria-label="Next">›</button>
        </div>
      </div>
      <div id="cal-body"></div>
    `;

    container.querySelectorAll('.seg-control button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode;
        this.render();
      });
    });
    document.getElementById('cal-prev').addEventListener('click', () => this._navigate(-1));
    document.getElementById('cal-next').addEventListener('click', () => this._navigate(1));

    if (this.mode === 'day') await this._renderDay();
    else if (this.mode === 'week') await this._renderWeek();
    else await this._renderMonth();
  },

  _navigate(dir) {
    if (this.mode === 'day') this.anchorDate = addDays(this.anchorDate, dir);
    else if (this.mode === 'week') this.anchorDate = addDays(this.anchorDate, dir * 7);
    else {
      const d = parseDateKey(this.anchorDate);
      d.setMonth(d.getMonth() + dir);
      this.anchorDate = toDateKey(d);
    }
    this.render();
  },

  async _renderDay() {
    document.getElementById('cal-label').textContent = formatDateLabel(this.anchorDate);
    const tasks = await TaskManager.getForDate(this.anchorDate);
    const timed = tasks.filter(t => t.dueTime).sort((a, b) => a.dueTime.localeCompare(b.dueTime));
    const anytime = tasks.filter(t => !t.dueTime);
    const categories = await CategoryManager.getAll();

    const body = document.getElementById('cal-body');
    if (tasks.length === 0) {
      body.innerHTML = `<div class="empty-state">Nothing scheduled for ${formatDateLabel(this.anchorDate).toLowerCase()}. Tap + to add a task.</div>`;
      return;
    }

    let html = '<div class="day-timeline">';
    for (const t of timed) {
      html += renderTimelineRow(t, categories);
    }
    if (anytime.length) {
      html += `<div class="timeline-section-label">Anytime</div>`;
      for (const t of anytime) {
        html += renderTimelineRow(t, categories);
      }
    }
    html += '</div>';
    body.innerHTML = html;
    bindTaskCardEvents(body);
  },

  async _renderWeek() {
    const d = parseDateKey(this.anchorDate);
    const dow = d.getDay();
    const weekStart = addDays(this.anchorDate, -dow);
    const weekEnd = addDays(weekStart, 6);
    document.getElementById('cal-label').textContent = `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`;

    const allTasks = await TaskManager.getAll();
    const body = document.getElementById('cal-body');
    let html = '<div class="week-grid">';
    for (let i = 0; i < 7; i++) {
      const dateKey = addDays(weekStart, i);
      const dayTasks = allTasks.filter(t => t.dueDate === dateKey && t.status !== 'cancelled' && !TaskManager._isTemplate(t));
      const isToday = dateKey === todayKey();
      html += `
        <div class="week-day ${isToday ? 'is-today' : ''}" data-date="${dateKey}">
          <div class="week-day-head">
            <span class="week-day-name">${WEEKDAY_NAMES[i].slice(0, 3)}</span>
            <span class="week-day-num">${parseDateKey(dateKey).getDate()}</span>
          </div>
          <div class="week-day-tasks">
            ${dayTasks.slice(0, 4).map(t => `<div class="week-task-chip priority-${t.priority} ${t.status === 'completed' ? 'is-done' : ''}">${escapeHtml(t.title)}</div>`).join('')}
            ${dayTasks.length > 4 ? `<div class="week-task-more">+${dayTasks.length - 4} more</div>` : ''}
          </div>
        </div>`;
    }
    html += '</div>';
    body.innerHTML = html;
    body.querySelectorAll('.week-day').forEach(el => {
      el.addEventListener('click', () => {
        this.anchorDate = el.dataset.date;
        this.mode = 'day';
        this.render();
      });
    });
  },

  async _renderMonth() {
    const d = parseDateKey(this.anchorDate);
    const year = d.getFullYear();
    const month = d.getMonth();
    document.getElementById('cal-label').textContent = `${MONTH_NAMES[month]} ${year}`;

    const firstOfMonth = new Date(year, month, 1);
    const startDow = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const allTasks = await TaskManager.getAll();
    const today = todayKey();

    let html = '<div class="month-grid">';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(h => { html += `<div class="month-head">${h}</div>`; });
    for (let i = 0; i < startDow; i++) html += `<div class="month-cell empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = toDateKey(new Date(year, month, day));
      const count = allTasks.filter(t => t.dueDate === dateKey && t.status !== 'cancelled' && t.status !== 'completed' && !TaskManager._isTemplate(t)).length;
      html += `
        <div class="month-cell ${dateKey === today ? 'is-today' : ''}" data-date="${dateKey}">
          <span class="month-cell-num">${day}</span>
          ${count ? `<span class="month-cell-dot">${count}</span>` : ''}
        </div>`;
    }
    html += '</div>';
    document.getElementById('cal-body').innerHTML = html;
    document.querySelectorAll('.month-cell[data-date]').forEach(el => {
      el.addEventListener('click', () => {
        this.anchorDate = el.dataset.date;
        this.mode = 'day';
        this.render();
      });
    });
  }
};

function renderTimelineRow(task, categories) {
  const cat = categories.find(c => c.id === task.category);
  return `
    <div class="timeline-row">
      <div class="timeline-time">${task.dueTime ? formatTime12(task.dueTime) : ''}</div>
      <div class="timeline-connector"><span class="dot" style="background:${cat ? cat.color : '#999'}"></span></div>
      ${renderTaskCard(task, cat)}
    </div>`;
}
