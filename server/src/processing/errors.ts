export type ErrorCode =
  | 'error.request.invalid'
  | 'error.request.content_type'
  | 'error.link.invalid'
  | 'error.video.not_found'
  | 'error.video.no_stream'
  | 'error.provider.unreachable'
  | 'error.provider.rate_limited'
  | 'error.provider.timeout'
  | 'error.rate_exceeded'
  | 'error.tunnel.expired'
  | 'error.tunnel.failed'
  | 'error.not_found'
  | 'error.internal';

/** An error that is safe to show to the client: stable code, HTTP status, readable message. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export const INVALID_LINK_MESSAGE =
  'Enter a valid TikTok link (tiktok.com, vm.tiktok.com, or vt.tiktok.com).';

export const errors = {
  invalidRequest: () =>
    new ApiError('error.request.invalid', 400, 'The request body is not valid.'),
  contentType: () =>
    new ApiError('error.request.content_type', 415, 'Send the request as application/json.'),
  invalidLink: () => new ApiError('error.link.invalid', 400, INVALID_LINK_MESSAGE),
  videoNotFound: (detail?: string) =>
    new ApiError(
      'error.video.not_found',
      404,
      detail || 'Video not found. Make sure the TikTok video is public.',
    ),
  noStream: () =>
    new ApiError('error.video.no_stream', 404, 'No downloadable video stream was found for this link.'),
  providerUnreachable: () =>
    new ApiError(
      'error.provider.unreachable',
      502,
      'Unable to fetch that video right now. Verify the link is public and try again.',
    ),
  providerRateLimited: () =>
    new ApiError(
      'error.provider.rate_limited',
      503,
      'The video resolver is busy. Try again in a few seconds.',
    ),
  providerTimeout: () =>
    new ApiError('error.provider.timeout', 504, 'The request timed out. Check the link and try again.'),
  rateExceeded: () =>
    new ApiError('error.rate_exceeded', 429, 'Too many requests. Wait a moment and try again.'),
  tunnelExpired: () =>
    new ApiError('error.tunnel.expired', 404, 'Download link expired. Paste the TikTok link again.'),
  tunnelFailed: () =>
    new ApiError('error.tunnel.failed', 502, 'Download stream interrupted. Please try again.'),
  notFound: () => new ApiError('error.not_found', 404, 'Not found.'),
};
