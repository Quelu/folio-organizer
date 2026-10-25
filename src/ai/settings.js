import { DEFAULT_MODEL } from './models';

/**
 * Assistant settings, kept apart from the main state so the API key never ends up in a backup file.
 * { apiKey, model, effort, webSearch }
 */
const SETTINGS_KEY = 'folio-ai-settings';

const DEFAULTS = { apiKey: '', model: DEFAULT_MODEL, effort: 'medium', webSearch: false };

export const loadAiSettings = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
};

export const saveAiSettings = (settings) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings simply won't persist
  }
};
