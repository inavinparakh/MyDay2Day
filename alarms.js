/* alarms.js — standalone alarm clock (like a phone clock app) plus the ringing
   engine shared with task alarms. Sound is synthesized with the Web Audio API
   so the app needs no bundled audio file and works fully offline.
   LIMITATION: like reminders, an alarm can only ring while this browser tab
   or PWA process is alive. If Android fully kills the tab, or the phone is
   locked and the browser is backgrounded long enough to be suspended, the
   alarm will not sound — the same limitation every browser-based alarm app
   has. See README for the native-wrapper mitigation. */

const AlarmEngine = {
  _timer: null,
  _audioCtx: null,
  _ringing: null, // { label, stop() }
  _firedToday: new Set(),

  async init() {
    this._timer = setInterval(() => this.checkAlarms(), 15000);
    this.checkAlarms();
  },

  async getAll() {
    return db.getAll(STORE_ALARMS);
  },

  async add(input) {
    const alarm = {
      id: uid('alarm'),
      time: input.time,
      label: input.label || 'Alarm',
      repeatDays: input.repeatDays || [], // [] = one-time
      enabled: true,
      sound: input.sound || 'classic',
      snoozedUntil: null,
      firedDateKey: null
    };
    await db.put(STORE_ALARMS, alarm);
    return alarm;
  },

  async update(id, patch) {
    const a = await db.get(STORE_ALARMS, id);
    if (!a) return;
    await db.put(STORE_ALARMS, { ...a, ...patch });
  },

  async delete(id) {
    await db.delete(STORE_ALARMS, id);
  },

  async checkAlarms() {
    const alarms = await this.getAll();
    const now = new Date();
    const hhmm = nowHHMM();
    const today = todayKey();
    const dow = now.getDay();

    for (const alarm of alarms) {
      if (!alarm.enabled) continue;

      if (alarm.snoozedUntil && Date.now() >= alarm.snoozedUntil) {
        this.ring(alarm);
        await this.update(alarm.id, { snoozedUntil: null, firedDateKey: today });
        continue;
      }

      if (alarm.time !== hhmm) continue;
      if (alarm.firedDateKey === today) continue;
      if (alarm.repeatDays.length && !alarm.repeatDays.includes(dow)) continue;

      this.ring(alarm);
      await this.update(alarm.id, { firedDateKey: today, enabled: alarm.repeatDays.length > 0 ? true : false });
    }
  },

  ring(alarm) {
    this.ringForTask({ id: alarm.id, title: alarm.label, _isAlarm: true, _alarmRef: alarm });
  },

  ringForTask(task) {
    if (this._ringing) return; // already ringing something
    this._startTone();
    this._showRingScreen(task);
  },

  _startTone() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new Ctx();
      const ctx = this._audioCtx;
      const playBeep = () => {
        if (!this._audioCtx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.45);
      };
      playBeep();
      this._beepInterval = setInterval(playBeep, 700);
    } catch (e) {
      console.warn('Web Audio unavailable', e);
    }
  },

  _stopTone() {
    clearInterval(this._beepInterval);
    if (this._audioCtx) {
      this._audioCtx.close();
      this._audioCtx = null;
    }
  },

  _showRingScreen(task) {
    const root = document.getElementById('alarm-ring-root');
    root.innerHTML = `
      <div class="alarm-ring-screen">
        <div class="alarm-ring-time">${formatTime12(nowHHMM())}</div>
        <div class="alarm-ring-label">${escapeHtml(task.title)}</div>
        <div class="alarm-ring-actions">
          ${task._isAlarm ? '<button id="alarm-snooze" class="btn btn-secondary">Snooze 5 min</button>' : ''}
          <button id="alarm-stop" class="btn btn-primary">Stop</button>
        </div>
      </div>`;
    root.classList.add('open');
    this._ringing = task;

    document.getElementById('alarm-stop').addEventListener('click', () => this._stopRinging());
    if (task._isAlarm) {
      document.getElementById('alarm-snooze').addEventListener('click', async () => {
        await this.update(task._alarmRef.id, { snoozedUntil: Date.now() + 5 * 60000 });
        this._stopRinging();
      });
    }
  },

  _stopRinging() {
    this._stopTone();
    document.getElementById('alarm-ring-root').classList.remove('open');
    document.getElementById('alarm-ring-root').innerHTML = '';
    this._ringing = null;
  }
};

/* --- Alarm list UI (Settings > Alarms, or its own tab section) --- */
const AlarmUI = {
  async render() {
    const container = document.getElementById('alarms-list');
    if (!container) return;
    const alarms = (await AlarmEngine.getAll()).sort((a, b) => a.time.localeCompare(b.time));
    if (alarms.length === 0) {
      container.innerHTML = `<div class="empty-state">No alarms yet. Tap + Add Alarm.</div>`;
      return;
    }
    container.innerHTML = alarms.map(a => `
      <div class="alarm-row" data-id="${a.id}">
        <div class="alarm-row-main">
          <span class="alarm-row-time">${formatTime12(a.time)}</span>
          <span class="alarm-row-label">${escapeHtml(a.label)}${a.repeatDays.length ? ` · ${a.repeatDays.map(d => WEEKDAY_NAMES[d].slice(0,3)).join(' ')}` : ' · Once'}</span>
        </div>
        <label class="switch">
          <input type="checkbox" ${a.enabled ? 'checked' : ''} data-action="toggle">
          <span class="slider"></span>
        </label>
        <button class="icon-btn" data-action="delete">🗑</button>
      </div>`).join('');

    container.querySelectorAll('.alarm-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-action="toggle"]').addEventListener('change', async (e) => {
        await AlarmEngine.update(id, { enabled: e.target.checked, firedDateKey: null });
      });
      row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (confirm('Delete this alarm?')) {
          await AlarmEngine.delete(id);
          AlarmUI.render();
        }
      });
    });
  },

  openAddForm() {
    const modal = document.getElementById('modal-root');
    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header"><h2>New Alarm</h2><button class="icon-btn" id="modal-close">✕</button></div>
          <form id="alarm-form" class="modal-form">
            <label class="field"><span>Time</span><input type="time" name="time" required></label>
            <label class="field"><span>Label</span><input type="text" name="label" placeholder="e.g. Wake Up" value="Alarm"></label>
            <label class="field"><span>Repeat</span></label>
            <div class="weekday-picker">
              ${['Su','Mo','Tu','We','Th','Fr','Sa'].map((d, i) => `<label><input type="checkbox" name="repeatDay" value="${i}"><span>${d}</span></label>`).join('')}
            </div>
            <div class="modal-actions">
              <span></span>
              <button type="submit" class="btn btn-primary">Save Alarm</button>
            </div>
          </form>
        </div>
      </div>`;
    document.getElementById('modal-close').addEventListener('click', () => TaskModal.close());
    document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') TaskModal.close(); });
    document.getElementById('alarm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await AlarmEngine.add({
        time: fd.get('time'),
        label: fd.get('label'),
        repeatDays: fd.getAll('repeatDay').map(Number)
      });
      TaskModal.close();
      AlarmUI.render();
    });
    document.getElementById('modal-root').classList.add('open');
  }
};
