export class IgleError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "IgleError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function apiError(error: unknown) {
  if (error instanceof IgleError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, details: error.details } }
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error",
        details: {}
      }
    }
  };
}
