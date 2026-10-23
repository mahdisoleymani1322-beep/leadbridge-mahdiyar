function isRetriableModelError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return /429|rate.?limit|quota|503|502|overloaded|unavailable|timeout|provider returned error/i.test(String(err));
  }

  const error = err as { message?: unknown; statusCode?: unknown; isRetryable?: unknown; responseBody?: unknown; cause?: unknown };
  if (error.isRetryable === true) return true;

  const status = Number(error.statusCode);
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;

  const details = [error.message, error.responseBody].filter((value): value is string => typeof value === "string").join(" " );
  if (/429|rate.?limit|quota|503|502|overloaded|unavailable|timeout|provider returned error/i.test(details)) return true;

  if (error.cause && error.cause !== err) return isRetriableModelError(error.cause);
  return false;
}
