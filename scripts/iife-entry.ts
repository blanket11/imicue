import * as api from './browser-entry.js';

// Loading a script only installs the API; it never creates or starts a tracker.
if (typeof window !== 'undefined') {
  if ('Imicue' in window) console.warn('imicue:global_conflict');
  else Object.defineProperty(window, 'Imicue', { value: Object.freeze({ ...api }), writable: false, configurable: false });
}
