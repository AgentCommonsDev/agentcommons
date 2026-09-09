export class SourceNotReadyError extends Error {
  constructor(readonly nativeId: string) {
    super("The active transcript branch has not been fully received.");
    this.name = "SourceNotReadyError";
  }
}
