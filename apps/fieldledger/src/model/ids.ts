/** Collision-safe checklist item IDs, generated offline (AC-FL-002-4). */
export function newItemId(randomUUID: () => string): string {
  return `ci-${randomUUID()}`;
}
