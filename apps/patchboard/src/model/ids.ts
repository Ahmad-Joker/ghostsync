/** Card IDs: collision-safe offline, independent of position, column and title. */
export function newCardId(randomUUID: () => string): string {
  return `card-${randomUUID()}`;
}