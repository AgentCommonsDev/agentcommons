export class SourceNotReadyError extends Error {
  readonly code = "SOURCE_NOT_READY";
  constructor(readonly nativeId: string) {
    super("The active transcript branch has not been fully received.");
    this.name = "SourceNotReadyError";
  }
}
