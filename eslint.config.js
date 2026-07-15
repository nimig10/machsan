import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '**/dist/**', '.claude/**', 'node_modules/**']),
  {
    // Node.js server code (Vercel serverless funcs + local scripts).
    files: ['api/**/*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
      'no-empty': 'warn',
    },
  },
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
      // Style/hygiene rules are kept on as warnings so CI doesn't go red on
      // pre-existing noise; only the blob-free guardrail below is error-level.
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
      'no-empty': 'warn',
      // ERROR-level: a used-but-undefined identifier is a guaranteed runtime
      // crash (e.g. a missing import). CI must fail on it. See the formatTime /
      // updateReservationStatus / deleteReservation incidents.
      'no-undef': 'error',
      // ERROR-level: a conditional hook (e.g. a useMemo after an early return)
      // shifts the hook order between renders and throws "Rendered more hooks
      // than during the previous render" — a hard crash, latent until the guard
      // first fires. Same reasoning as no-undef above. The other react-hooks
      // rules stay warn-level: they flag style/staleness, not guaranteed crashes.
      'react-hooks/rules-of-hooks': 'error',
      'no-useless-escape': 'warn',
      'no-constant-binary-expression': 'warn',
      'no-dupe-keys': 'warn',
      'react-refresh/only-export-components': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',

      // BLOB-FREE GUARDRAIL
      // The legacy public.store JSONB blob was decommissioned (migration
      // 20260430220000). Every domain entity must live in a dedicated table
      // with its own RLS + realtime. These rules block accidental regression.
      // See CLAUDE.md -> "Adding a new feature".
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='storageGet']",
          message: 'storageGet is removed -- use src/utils/<entity>Api.js (e.g. listKits, listLessons) instead.',
        },
        {
          selector: "CallExpression[callee.name='storageSet']",
          message: 'storageSet is removed -- use src/utils/<entity>Api.js (e.g. syncAllKits, upsertLesson) instead.',
        },
        {
          selector: "CallExpression[callee.property.name='from'][arguments.0.value='store']",
          message: "Direct reads from public.store are forbidden -- that table no longer exists. Use the entity's API util.",
        },
        {
          selector: "CallExpression[callee.property.name='from'][arguments.0.value='store_snapshots']",
          message: 'public.store_snapshots was dropped -- read from the entity table directly.',
        },
        {
          selector: "Literal[value=/\\/api\\/store(\\?|$)/]",
          message: '/api/store endpoint was deleted -- call the entity API util or supabase.from(<table>) directly.',
        },
      ],
    },
  },
])
