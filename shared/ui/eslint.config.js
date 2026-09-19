import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import tailwind from 'eslint-plugin-tailwindcss';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'wailsjs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  tailwind.configs.recommended,
  { settings: { tailwindcss: { cssConfigPath: path.join(__dirname, 'src', 'styles.css') } } },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Only the classic hook rules: eslint-plugin-react-hooks 7's `recommended` adds the React
      // Compiler rules (set-state-in-effect, refs, purity...), which need their own cleanup pass.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'tailwindcss/no-custom-classname': 'off',
      // Tailwind 4 syntax-preference rules: `[var(--x)]` and `(--x)` are both valid, so don't
      // churn hundreds of class strings just to switch spelling.
      'tailwindcss/enforces-canonical-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
    },
  },
);
