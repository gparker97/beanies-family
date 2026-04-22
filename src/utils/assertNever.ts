/**
 * Compile-time exhaustiveness check for discriminated unions.
 *
 * Place in the `default` branch of a `switch` over a union to force TypeScript
 * to fail the build when a new variant is added. The `: never` parameter type
 * ensures the call only type-checks if every possible value has already been
 * handled.
 *
 * At runtime, throws — so any value that slips past TypeScript (e.g. data
 * loaded from disk that doesn't match the current type) fails loudly with a
 * clear message rather than producing silently wrong output.
 *
 * @example
 *   switch (tx.type) {
 *     case 'income': return ...;
 *     case 'expense': return ...;
 *     case 'transfer': return ...;
 *     case 'balance_adjustment': return ...;
 *     default: assertNever(tx.type, 'transactionToChange');
 *   }
 *
 * @param value - The unhandled value (typed as `never` if the switch is exhaustive)
 * @param context - A short tag identifying the call site for error messages
 */
export function assertNever(value: never, context: string): never {
  throw new Error(
    `[${context}] Non-exhaustive type encountered at runtime: ${JSON.stringify(value)}`
  );
}
