import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { sessionIdSchema } from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { dateTime, number, operationLabel, textValue } from "../../lib/display";
import type { SessionHeader } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import {
  DefinitionList,
  LoadingState,
  RequestError,
} from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { EmptyState } from "../../components/ui/feedback";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";

const labels = copy.sessions.detail.files;
const fileRow = z.tuple([z.string(), z.array(z.string())]);
const commitRow = z.tuple([
  z.coerce.number(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
]);
const statsRow = z.tuple([z.number().nullable(), z.string().nullable()]);
const operationOrder = [
  "write",
  "edit",
  "create",
  "delete",
  "read",
  "search",
  "list",
];
/** Files, commits and end-of-session Git state, all from api_ro views for this session. */
export function FilesTab({ header }: { header: SessionHeader }) {
  const { organization } = useWorkspace();
  // The id is a validated UUID before it enters SQL text.
  const id = sessionIdSchema.parse(header.session_id);
  const run = async <T,>(
    sql: string,
    row: z.ZodType<T>,
    signal: AbortSignal,
  ) => {
    const result = unwrap(
      await api.POST("/api/v1/query", { body: { sql }, signal }),
    );
    return result.rows.flatMap((item) => {
      const parsed = row.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  };
  const files = useQuery({
    queryKey: [organization.id, "session-files", id],
    queryFn: ({ signal }) =>
      run(
        `SELECT path, ops FROM session_files WHERE session_id = '${id}' ORDER BY path LIMIT 500`,
        fileRow,
        signal,
      ),
  });
  const commits = useQuery({
    queryKey: [organization.id, "session-commits", id],
    queryFn: ({ signal }) =>
      run(
        `SELECT ordinal, sha, subject, author, timestamp FROM session_observed_commits WHERE session_id = '${id}' ORDER BY ordinal LIMIT 500`,
        commitRow,
        signal,
      ),
  });
  const stats = useQuery({
    queryKey: [organization.id, "session-git-state", id],
    queryFn: ({ signal }) =>
      run(
        `SELECT dirty_file_count, observed_diff_stat FROM sessions WHERE session_id = '${id}'`,
        statsRow,
        signal,
      ),
  });
  if (files.isPending || commits.isPending || stats.isPending)
    return <LoadingState />;
  const error = files.error ?? commits.error ?? stats.error;
  if (error)
    return (
      <RequestError
        error={error}
        retry={() => {
          void Promise.all([
            files.refetch(),
            commits.refetch(),
            stats.refetch(),
          ]);
        }}
      />
    );
  const fileRows = files.data ?? [];
  const commitRows = commits.data ?? [];
  const groups = new Map<string, string[]>();
  for (const [path, ops] of fileRows)
    for (const op of ops.length ? ops : [labels.operationsLabel.other]) {
      const group = groups.get(op) ?? [];
      group.push(path);
      groups.set(op, group);
    }
  const ordered = [...groups.entries()].sort(
    ([a], [b]) =>
      (operationOrder.includes(a) ? operationOrder.indexOf(a) : 99) -
        (operationOrder.includes(b) ? operationOrder.indexOf(b) : 99) ||
      a.localeCompare(b),
  );
  const [dirty, diffStat] = stats.data?.[0] ?? [null, null];
  let diff: unknown = null;
  try {
    diff = diffStat === null ? null : JSON.parse(diffStat);
  } catch {
    diff = diffStat;
  }
  const diffText =
    diff === null
      ? copy.app.common.unavailable
      : typeof diff === "object" && !Array.isArray(diff)
        ? Object.entries(diff)
            .map(([key, value]) => `${key}: ${textValue(value)}`)
            .join(copy.app.common.separator) || copy.app.common.unavailable
        : textValue(diff);
  return (
    <div className="flex flex-col gap-5" aria-label={labels.label}>
      <p className="text-sm text-muted">{labels.description}</p>
      <DefinitionList
        columns={4}
        items={[
          {
            label: copy.app.fields.file_count,
            value: number(header.file_count),
          },
          {
            label: copy.app.fields.observed_commit_count,
            value: number(header.observed_commit_count),
          },
          { label: labels.dirty, value: number(dirty) },
          { label: labels.diffStat, value: diffText },
        ]}
      />
      {fileRows.length === 0 ? (
        <EmptyState
          compact
          title={labels.empty}
          description={labels.emptyHint}
        />
      ) : (
        ordered.map(([operation, paths]) => (
          <section key={operation} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-[13px] font-medium">
              {operationLabel(operation)}
              <Badge>{number(paths.length)}</Badge>
            </h3>
            <ul className="divide-y divide-line-soft rounded-lg border border-line bg-surface">
              {paths.map((path) => (
                <li
                  key={path}
                  className="px-3 py-1.5 font-mono text-xs break-all"
                >
                  {path}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {header.file_count > fileRows.length ? (
        <p className="text-xs text-muted">{labels.capped}</p>
      ) : null}
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium">{labels.commits}</h3>
        {commitRows.length === 0 ? (
          <EmptyState compact title={labels.commitsEmpty} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <Table className="stacked-table">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-28">{labels.sha}</TableHead>
                  <TableHead>{labels.subject}</TableHead>
                  <TableHead className="w-36">{labels.author}</TableHead>
                  <TableHead className="w-40">{labels.when}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commitRows.map(
                  ([ordinal, sha, subject, author, timestamp]) => (
                    <TableRow key={`${String(ordinal)}-${sha}`}>
                      <TableCell
                        data-label={labels.sha}
                        className="font-mono text-xs"
                      >
                        {sha.slice(0, 10)}
                      </TableCell>
                      <TableCell data-label={labels.subject}>
                        {subject}
                      </TableCell>
                      <TableCell data-label={labels.author}>{author}</TableCell>
                      <TableCell data-label={labels.when}>
                        {dateTime(timestamp)}
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
