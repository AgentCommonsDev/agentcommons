/** Quote each value as one POSIX shell argument; no interpolated value becomes code. */
export function formatInstallCommand(origin: string, key: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `curl -fsSL ${quote(new URL("/install.sh", origin).href)} | sh -s -- --key ${quote(key)}`;
}
