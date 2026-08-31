/* db.js — IndexedDB persistence layer for Navin Day Planner
   Stores: tasks, categories, settings, backupHistory, alarms
   All access is promise-based. No other module should touch indexedDB directly. */

const DB_NAME = 'navin-day-planner';
const DB_VERSION = 1;
const APP_VERSION = '1.0.0';

const STORE_TASKS = 'tasks';
const STORE_CATEGORIES = 'categories';
const STORE_SETTINGS = 'settings';
const STORE_BACKUP_HISTORY = 'backupHistory';
const STORE_ALARMS = 'alarms';

const DEFAULT_CATEGORIES = [
  { id: 'cat-lic', name: 'LIC', color: '#2F6F5E', isDefault: true },
  { id: 'cat-health', name: 'Health Insurance', color: '#C2572B', isDefault: true },
  { id: 'cat-claims', name: 'Claims', color: '#A6392B', isDefault: true },
  { id: 'cat-followup', name: 'Customer Follow-up', color: '#3B6EA5', isDefault: true },
  { id: 'cat-leads', name: 'New Leads', color: '#7A5CC0', isDefault: true },
  { id: 'cat-renewals', name: 'Renewals', color: '#B08900', isDefault: true },
  { id: 'cat-personal', name: 'Personal', color: '#5C6773', isDefault: true },
  { id: 'cat-finance', name: 'Finance', color: '#1F7A5C', isDefault: true },
  { id: 'cat-content', name: 'Content Creation', color: '#B0507A', isDefault: true },
  { id: 'cat-other', name: 'Other', color: '#7A7A7A', isDefault: true }
];

const DEFAULT_SETTINGS = {
  id: 'settings',
  name: '',
  defaultReminder: 15,
  defaultDuration: 30,
  carryForwardEnabled: true,
  startOfDayHour: 6,
  defaultAlarmSound: 'classic',
  theme: 'system',
  notificationsEnabled: false,
  lastCarryForwardRun: null,
  googleDrive: {
    connected: false,
    accessToken: null,
    tokenExpiry: null,
    folderId: null,
    email: null,
    lastBackup: null
  },
  dbVersion: DB_VERSION,
  appVersion: APP_VERSION
};

class DayPlannerDB {
  constructor() {
    this.db = null;
    this.ready = this._open();
  }

  _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_TASKS)) {
          const taskStore = db.createObjectStore(STORE_TASKS, { keyPath: 'id' });
          taskStore.createIndex('status', 'status', { unique: false });
          taskStore.createIndex('dueDate', 'dueDate', { unique: false });
          taskStore.createIndex('category', 'category', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
          db.createObjectStore(STORE_CATEGORIES, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(STORE_BACKUP_HISTORY)) {
          const bh = db.createObjectStore(STORE_BACKUP_HISTORY, { keyPath: 'id' });
          bh.createIndex('date', 'date', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_ALARMS)) {
          db.createObjectStore(STORE_ALARMS, { keyPath: 'id' });
        }
      };

      req.onsuccess = async (event) => {
        this.db = event.target.result;
        await this._seedDefaults();
        resolve(this.db);
      };

      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('IndexedDB upgrade blocked — close other tabs of this app.');
    });
  }

  async _seedDefaults() {
    const existingCats = await this.getAll(STORE_CATEGORIES);
    if (existingCats.length === 0) {
      for (const cat of DEFAULT_CATEGORIES) {
        await this.put(STORE_CATEGORIES, cat);
      }
    }
    const settings = await this.get(STORE_SETTINGS, 'settings');
    if (!settings) {
      await this.put(STORE_SETTINGS, { ...DEFAULT_SETTINGS });
    }
  }

  _tx(storeName, mode = 'readonly') {
    return this.db.transaction(storeName, mode).objectStore(storeName);
  }

  get(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  getAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  put(storeName, value) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  }

  putMany(storeName, values) {
    return new Promise((resolve, reject) => {
      const store = this._tx(storeName, 'readwrite');
      let count = 0;
      if (values.length === 0) return resolve();
      values.forEach((v) => {
        const req = store.put(v);
        req.onsuccess = () => {
          count++;
          if (count === values.length) resolve();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  clear(storeName) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getSettings() {
    return (await this.get(STORE_SETTINGS, 'settings')) || { ...DEFAULT_SETTINGS };
  }

  async updateSettings(patch) {
    const current = await this.getSettings();
    const updated = { ...current, ...patch };
    await this.put(STORE_SETTINGS, updated);
    return updated;
  }
}

const db = new DayPlannerDB();
