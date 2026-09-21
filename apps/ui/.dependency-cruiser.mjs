// Import-graph rules for apps/ui (verification tooling PRD phase 9, ADR 0062). Run over the real tree by
// `pnpm --dir apps/ui architecture` (the Nx target of the same name, part of `pnpm check`); src/architectureRules.test.ts
// proves each rule fires on a deliberate violation. A rule here is a mechanical import fact: which tokens and what looks
// right stay with design-spec-guard. Rules that need syntax rather than imports live beside this file's siblings
// (baseUiBoundary.test.ts, highlightBoundary.test.ts).
//
// The rule names appear in a failure, so each says what it protects and the comment says why.

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      // Primitives are the leaves of the component tree (ADR 0047, docs/design/design-system.md): a page or a feature
      // builds on them and never the other way round, otherwise a primitive cannot be documented or tested on its own
      // in the atlas. Stories and tests count: a story that imports a feature module needs that module's whole tree.
      // Only `src/components/` is fenced here: what a primitive may take from `src/` (types, hooks) is not decided by this rule.
      name: 'primitives-are-leaves',
      comment:
        'components/primitives/ imports nothing from a feature folder (home, manuscript, ...). Move what both need out of the feature, for example to src/.',
      severity: 'error',
      from: { path: '^src/components/primitives/' },
      to: { path: '^src/components/', pathNot: '^src/components/primitives/' },
    },
    {
      // The generated bindings are rewritten on every host API change, and everything that can be typed against the
      // wire lives behind src/api/wailsClient.ts (ADR 0007, the boundary PRD). A component that calls the host reaches
      // it through the API client, which the mock replaces in tests and in the visual suite.
      name: 'wails-bindings-only-in-api',
      comment: 'Only src/api/ imports wailsjs/. Call the host through the API client so the mock backend covers it.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/api/' },
      to: { path: '^wailsjs/' },
    },
    {
      // A second guard for ADR 0047. The first is baseUiBoundary.test.ts, which also sees dynamic imports, vi.mock and
      // declare module; this one is the plain import graph, so an import that resolves to the package is flagged with
      // the file it came from.
      name: 'base-ui-only-in-primitives',
      comment: 'Base UI is used only inside src/components/primitives/ (ADR 0047): import the primitive instead, or add one.',
      severity: 'error',
      from: { path: '^(src|tests)/', pathNot: '^src/components/primitives/' },
      to: { path: 'node_modules/@base-ui/' },
    },
  ],
  options: {
    // Follow imports into wailsjs/ (rule 2 needs to see them) but never into packages.
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'] },
  },
};
