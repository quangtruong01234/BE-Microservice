export type ErrorLike = {
  response?: unknown;
  statusCode?: unknown;
  status?: unknown;
  name?: unknown;
  message?: unknown;
  error?: unknown;
  /** Optional stable code from `libs/constant/error-code.constant.ts`. */
  errorCode?: unknown;
};
