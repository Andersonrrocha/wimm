// PostCSS pipeline for the renderer (Electron + Vite).
// Tailwind v4 processes `@import "tailwindcss"` in theme.css via the dedicated
// PostCSS plugin. Autoprefixer adds vendor prefixes for Electron's Chromium.

module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
