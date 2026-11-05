// ESLint: correctness checks only (undefined names, unreachable code, mistakes). Style is left alone.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['public/vendor/**', '.wrangler/**', 'node_modules/**', '.aws-sam/**', '.venv/**', 'apple-tv/**', 'media/**'] },
  js.configs.recommended,
  {
    // the site: browser ES modules, plus the classic scripts the pages load first
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, jsQR: 'readonly', MP4Box: 'readonly', Mp4Muxer: 'readonly', QRCode: 'readonly', d3: 'readonly', topojson: 'readonly' },
    },
  },
  {
    files: ['public/js/qrworker.js'],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    // the cloud, the dev server, the relay and the tests: Node
    files: ['**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
  },
  {
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
