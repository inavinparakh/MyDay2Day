/* notifications.js — task reminders using the Web Notifications API.
   IMPORTANT LIMITATION (documented, not hidden from the user):
   Browser/PWA notifications can only fire reliably while this app (or its
   service worker) is alive in the browser process. Most Android browsers
   suspend background tabs after a while, and a fully closed/terminated
   PWA cannot guarantee a wake-up at an exact future time the way a native
   Android app can. We mitigate this by:
     1. Checking due reminders every 20 seconds while the app is open.
     2. Re-checking immediately on every app foreground/visibility change.
     3. Registering a service worker so notifications can still be shown
        even when the app is in the background tab (not fully closed).
   For guaranteed wake-ups when the phone is locked and the app is fully
   closed, the app must be wrapped as a native Android app (see README). */

const NotificationManager = {
  _timer: null,

  async init() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkDueReminders();
    });
    this._timer = setInterval(() => this.checkDueReminders(), 20000);
    await this.scheduleAllReminders();
    this.updateStatusUI();
  },

  async requestPermission() {
    if (!('Notification' in window)) {
      alert('This browser does not support notifications. Reminders will still show inside the app while it is open.');
      return 'unsupported';
    }
    const result = await Notification.requestPermission();
    await db.updateSettings({ notificationsEnabled: result === 'granted' });
    this.updateStatusUI();
    return result;
  },

  async updateStatusUI() {
    const el = document.getElementById('notif-status');
    if (!el) return;
    if (!('Notification' in window)) {
      el.textContent = 'Notifications: Unsupported in this browser';
      el.className = 'status-pill status-warn';
      return;
    }
    if (Notification.permission === 'granted') {
      el.textContent = 'Notifications: Enabled';
      el.className = 'status-pill status-ok';
    } else if (Notification.permission === 'denied') {
      el.textContent = 'Notifications: Blocked — enable in browser settings';
      el.className = 'status-pill status-error';
    } else {
      el.textContent = 'Notifications: Permission required';
      el.className = 'status-pill status-warn';
    }
  },

  /* Recomputes nothing persistent — reminders are derived from task data
     every time we check, so editing a task automatically reschedules it. */
  async scheduleAllReminders() {
    // Intentionally stateless; checkDueReminders() reads live task data.
    return true;
  },

  async checkDueReminders() {
    const tasks = await TaskManager.getPendingAndCarried();
    const now = new Date();
    for (const task of tasks) {
      if (task.reminder == null || !task.dueTime) continue;
      const mins = minutesUntil(task.dueDate, task.dueTime);
      if (mins === null) continue;
      const fireWindow = task.reminder; // minutes before due time
      // Fire once when we cross into the reminder window (allow a small grace window)
      if (mins <= fireWindow && mins >= fireWindow - 1) {
        const key = `${task.id}:${task.dueDate}:${task.dueTime}`;
        if (task.notifiedReminderAt === key) continue;
        this.fire(task);
        await TaskManager.update(task.id, { notifiedReminderAt: key });
        if (task.alarmEnabled) AlarmEngine.ringForTask(task);
      }
    }
  },

  fire(task) {
    const title = `Reminder: ${task.title}`;
    const body = task.dueTime ? `Due at ${formatTime12(task.dueTime)}` : 'Due today';
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, tag: task.id, icon: 'icons/icon-192.png' });
      } catch (e) {
        this._inAppToast(title, body);
      }
    } else {
      this._inAppToast(title, body);
    }
  },

  _inAppToast(title, body) {
    const toast = document.createElement('div');
    toast.className = 'in-app-toast';
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>`;
    document.getElementById('toast-root').appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 6000);
  }
};
