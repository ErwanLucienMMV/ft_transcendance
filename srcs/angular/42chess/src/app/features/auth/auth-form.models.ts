/** Field limits mirror the existing NestJS login/register DTOs. */
export const AUTH_FIELD_LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  emailMax: 254,
  passwordMin: 8,
  passwordMax: 128,
} as const;

export interface LoginCredentials {
  login: string;
  password: string;
}

export interface RegisterCredentials {
  username: string;
  email: string;
  password: string;
}
