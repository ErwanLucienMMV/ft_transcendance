/** An authenticator code (6 digits) or a recovery code (two groups of five characters). */
export const SECOND_FACTOR_CODE = /^(?:\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/;
