/* categories.js — add/edit/delete categories used to tag tasks. */

const CategoryManager = {
  async getAll() {
    const cats = await db.getAll(STORE_CATEGORIES);
    return cats.sort((a, b) => a.name.localeCompare(b.name));
  },

  async add(name, color) {
    const cat = { id: uid('cat'), name: name.trim(), color: color || '#5C6773', isDefault: false };
    await db.put(STORE_CATEGORIES, cat);
    return cat;
  },

  async update(id, patch) {
    const cat = await db.get(STORE_CATEGORIES, id);
    if (!cat) throw new Error('Category not found');
    const updated = { ...cat, ...patch };
    await db.put(STORE_CATEGORIES, updated);
    return updated;
  },

  async delete(id) {
    const tasks = await TaskManager.getAll();
    const inUse = tasks.some(t => t.category === id);
    if (inUse) {
      const reassign = await db.get(STORE_CATEGORIES, 'cat-other');
      for (const t of tasks) {
        if (t.category === id) {
          t.category = 'cat-other';
          await db.put(STORE_TASKS, t);
        }
      }
    }
    await db.delete(STORE_CATEGORIES, id);
  }
};
