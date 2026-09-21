import { WireError } from './WireError';
import type { InferOutput, StandardSchemaV1 } from './standardSchema';

/** Which boundary a value crossed and which payload it was, for the error and the host log. */
export type WireContext = { boundary: string; payload: string };

/**
 * The one way a value crossing into the UI is checked (ADR 0069). Every binding result, live event and mock answer goes
 * through it, so a wrong shape fails here, loudly and by name, and not three components later as a blank chart.
 *
 * Typed on Standard Schema and not on Zod: no caller depends on the library. Reads are lenient about keys the schema does
 * not declare (a newer sidecar or host must still load); the contract tests are strict (`schemas/strictness.ts`).
 */
export function parseWire<S extends StandardSchemaV1>(schema: S, payload: unknown, context: WireContext): InferOutput<S> {
  const result = schema['~standard'].validate(payload);
  if (result instanceof Promise) throw new TypeError(`${context.boundary} ${context.payload}: a wire schema must validate synchronously`);
  if (result.issues) throw WireError.fromIssues(context.boundary, context.payload, result.issues);
  return result.value;
}

/**
 * A Wails string binding: the host sends JSON text, and an empty string means no value. Text that is not JSON is a wire
 * error too, and the error does not quote it.
 */
export function parseWireJson<S extends StandardSchemaV1>(schema: S, text: string, context: WireContext): InferOutput<S> {
  let value: unknown;
  if (text !== '') {
    try {
      value = JSON.parse(text);
    } catch {
      throw new WireError(context.boundary, context.payload, [{ path: '(root)', message: 'not valid JSON' }]);
    }
  }
  return parseWire(schema, value, context);
}
