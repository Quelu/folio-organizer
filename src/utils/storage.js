const STORAGE_KEY = 'binder-organizer-state';

export const loadState = () => {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    return serialized ? JSON.parse(serialized) : null;
  } catch {
    return null;
  }
};

export const saveState = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore write errors (storage full, private mode, etc.)
  }
};

/** A backup file's contents: the whole state, as the "Sauvegarder" button downloads it. */
export const serializeBackup = (state) => JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
