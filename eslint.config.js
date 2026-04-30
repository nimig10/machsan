import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],

      // ── BLOB-FREE GUARDRAIL ──────────────────────────────────────────────
      // The legacy public.store JSONB blob was decommissioned (migration
      // 20260430220000). Every domain entity must live in a dedicated table
      // with its own RLS + realtime. These rules block accidental regression.
      // See CLAUDE.md → "Adding a new feature".
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='storageGet']",
          message: 'storageGet is removed — use src/utils/<entity>Api.js (e.g. listKits, listLessons) instead.',
        },
        {
          selector: "CallExpression[callee.name='storageSet']",
          message: 'storageSet is removed — use src/utils/<entity>Api.js (e.g. syncAllKits, upsertLesson) instead.',
        },
        {
          selector: "CallExpression[callee.property.name='from'][arguments.0.value='store']",
          message: "Direct reads from public.store are forbidden — that table no longer exists. Use the entity's API util.",
        },
        {
          selector: "CallExpression[callee.property.name='from'][arguments.0.value='store_snapshots']",
          message: 'public.store_snapshots was dropped — read from the entity table directly.',
        },
        {
          selector: "Literal[value=/\\/api\\/store(\\?|$)/]",
          message: '/api/store endpoint was deleted — call the entity API util or supabase.from(<table>) directly.',
        },
      ],
    },
  },
])
