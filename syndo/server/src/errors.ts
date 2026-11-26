export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const bad = (msg: string, code = "invalid") => new ApiError(400, code, msg);
export const unauthorized = (msg = "Sign in to continue.") => new ApiError(401, "unauthorized", msg);
export const forbidden = (msg = "You don't have permission to do that.") => new ApiError(403, "forbidden", msg);
export const notFound = (what = "That") => new ApiError(404, "not_found", `${what} doesn't exist or you can't see it.`);
export const conflict = (msg: string, code = "conflict") => new ApiError(409, code, msg);
export const tooMany = (msg: string, retryAfter?: number) => Object.assign(new ApiError(429, "rate_limited", msg), { retryAfter });
