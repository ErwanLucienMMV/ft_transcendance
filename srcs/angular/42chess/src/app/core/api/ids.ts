/** The shape of the ids the API hands out (UUIDs): anything else names nothing. */
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** True for a well-formed id; pages check before calling the API with an address typed by hand. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}
