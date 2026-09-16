// In local dev this is empty, so requests stay relative and go through
// Vite's proxy (see vite.config.js) to the local server — same-origin, no
// CORS needed. In production the frontend and backend are deployed
// separately (frontend on static hosting, backend on Render), so this is
// baked in at build time via VITE_API_BASE_URL.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}
