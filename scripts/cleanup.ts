/** Release resources in dependency order, even when an earlier release fails. */
export async function cleanup(actions: Array<() => Promise<unknown>>) {
  const errors: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}
