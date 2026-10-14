/** UUID values are validated at transport/domain boundaries and stored as PostgreSQL uuid. */
export type UUID = string;
/** JSON timestamps use ISO-8601 UTC strings, not epoch values. */
export type ISODateString = string;

/** Spec §34; codes may be extended by each feature without changing the envelope. */
export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: string[];
}

export interface Pagination {
  limit: number;
  offset: number;
}
/** For endpoints that explicitly opt into pagination; complete game history is unpaged. */
export interface PaginatedResponse<T> extends Pagination {
  items: T[];
  total: number;
}
/** Named collections in the spec, e.g. { moves: [...] }, { users: [...] }. */
export type CollectionResponse<Key extends string, Item> = Record<Key, Item[]>;
export interface HealthResponse {
  status: 'ok';
}
export interface CreateGameResponse {
  gameId: UUID;
  status: 'WAITING';
}
