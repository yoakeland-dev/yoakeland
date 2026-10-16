// The Content-Security-Policy of every page the app shows. svelte.config.js hands it to SvelteKit,
// which writes it into the built index.html with the hash of the inline bootstrap script; main.js
// sends the same policy as the app:// response header.
// Google Fonts is the one outside origin: app.css imports Questrial from it. Self-host the font and drop both.
export const CSP = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  // https images: a model's markdown image waits for a click, then loads from its own host (sanitize.ts).
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  "media-src": ["'self'", "blob:", "data:"],
  // The hosted web client talks to a server over wss:, and to any server the user types in.
  "connect-src": ["'self'", "ws:", "wss:", "http:", "https:"],
  "worker-src": ["'self'", "blob:"],
  // The web build's browser panel is an iframe on any page; the PDF preview is a blob.
  "frame-src": ["'self'", "blob:", "http:", "https:"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
};
