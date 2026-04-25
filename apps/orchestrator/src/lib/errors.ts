export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export class RejectProspectError extends PipelineError {
  constructor(reason: string, message?: string) {
    super(message ?? reason, reason, false);
    this.name = "RejectProspectError";
  }
}
