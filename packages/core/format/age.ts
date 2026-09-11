/**
 * "13 minutes ago", "2 hours ago", "3 days ago": the distance between two instants,
 * coarsely. An import-free leaf so the zero-dependency hook bundle can date the sessions
 * its recall hint names (§6.2) without pulling the dashboard formatter in.
 */
export function ageInWords(from: string, now: Date): string {
  const plural = (count: number, noun: string) =>
    `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
  const seconds = Math.max(
    0,
    (now.getTime() - new Date(from).getTime()) / 1000,
  );
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${plural(Math.max(1, minutes), "minute")} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.round(hours / 24), "day")} ago`;
}
