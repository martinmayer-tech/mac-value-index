// Prettier settings matching the gts (Google TypeScript Style) conventions.
// See https://github.com/google/gts/blob/main/.prettierrc.json

/** @type {import('prettier').Config} */
export const prettierConfig = {
  bracketSpacing: false,
  singleQuote: true,
  trailingComma: 'all',
  arrowParens: 'avoid',
  plugins: ['prettier-plugin-astro'],
  overrides: [{files: '*.astro', options: {parser: 'astro'}}],
};
