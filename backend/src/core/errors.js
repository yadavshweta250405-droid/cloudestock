export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (m, d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Authentication required') => new HttpError(401, m);
export const forbidden = (m = 'You do not have permission to do this') => new HttpError(403, m);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const conflict = (m, d) => new HttpError(409, m, d);
export const invalid = (errors) => new HttpError(422, 'Validation failed', errors);
