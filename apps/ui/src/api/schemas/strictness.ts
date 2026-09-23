import type { z } from 'zod';

// Schemas are lenient about keys they do not declare, because a newer host or sidecar must still load (ADR 0069). The contract
// tests are the other half of that rule: they call `unknownKeys` on every golden payload and every mock answer and fail on any
// key the schema does not declare, so drift is caught in both directions. It reads the schema's own definition (Zod's `_zod.def`,
// the documented surface for library authors) and is used by tests only.

type Def = { type: string } & Record<string, unknown>;
const defOf = (schema: unknown): Def => (schema as { _zod: { def: Def } })._zod.def;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const child = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path === '' ? key : `${path}.${key}`);

function walk(schema: unknown, value: unknown, path: string, found: string[]): void {
  const def = defOf(schema);
  switch (def.type) {
    case 'object': {
      if (!isRecord(value)) return;
      const shape = def.shape as Record<string, unknown>;
      for (const [key, inner] of Object.entries(value)) {
        if (key in shape) walk(shape[key], inner, child(path, key), found);
        else found.push(child(path, key));
      }
      return;
    }
    case 'array':
      if (Array.isArray(value)) value.forEach((item, index) => walk(def.element, item, child(path, index), found));
      return;
    case 'tuple':
      if (Array.isArray(value)) (def.items as unknown[]).forEach((item, index) => walk(item, value[index], child(path, index), found));
      return;
    case 'record':
      if (isRecord(value)) for (const [key, inner] of Object.entries(value)) walk(def.valueType, inner, child(path, key), found);
      return;
    case 'union': {
      // The branch that accepts the value is the one whose keys count.
      const options = def.options as Array<z.ZodType>;
      const match = options.find((option) => option.safeParse(value).success);
      if (match) walk(match, value, path, found);
      return;
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'nonoptional':
    case 'readonly':
      walk(def.innerType, value, path, found);
      return;
    case 'pipe':
      walk(def.in, value, path, found);
      return;
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'undefined':
    case 'literal':
    case 'enum':
      return;
    case 'unknown':
      // An opaque value on purpose (a finding's analyzer-specific evidence, findings-contract.md): the schema declares no keys
      // under it, so there is nothing to call undeclared.
      return;
    default:
      // A schema kind this walker does not know would silently hide undeclared keys under it, so it is an error to add one unseen.
      throw new Error(`unknownKeys does not know the schema kind "${def.type}"; teach schemas/strictness.ts to walk it`);
  }
}

/** The paths of keys in `value` that `schema` does not declare, as `rows[1].oops`. Empty when the payload declares everything. */
export function unknownKeys(schema: z.ZodType, value: unknown): string[] {
  const found: string[] = [];
  walk(schema, value, '', found);
  return found;
}
