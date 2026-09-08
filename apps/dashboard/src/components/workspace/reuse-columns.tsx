import type { ColumnDef } from "@tanstack/react-table";
import type { z } from "zod";
import type { reuseEdgeSchema } from "@agentcommons/core/schemas/rest";
import { copy } from "../../copy";
import { dateTime, harnessLabel } from "../../lib/display";
import { ShortenedFields, CopyButton } from "./primitives";
export type ReuseEdge = z.infer<typeof reuseEdgeSchema>;
export function reuseColumns<T>(
  edge: (row: T) => ReuseEdge | null,
): ColumnDef<T>[] {
  return [
    {
      id: "target_title",
      accessorFn: (row) => edge(row)?.target_title,
      header: copy.workspace.home.target,
      cell: ({ row }) => {
        const value = edge(row.original);
        return value ? (
          <a href={`/s/${value.target_session_id}`}>
            {value.target_title ?? copy.workspace.sessions.untitled}
          </a>
        ) : null;
      },
    },
    {
      id: "source_title",
      accessorFn: (row) => edge(row)?.source_title,
      header: copy.workspace.home.source,
      cell: ({ row }) => {
        const value = edge(row.original);
        return value ? (
          <a href={`/s/${value.source_session_id}`}>
            {value.source_title ?? copy.workspace.sessions.untitled}
          </a>
        ) : null;
      },
    },
    {
      id: "reader_email",
      accessorFn: (row) => edge(row)?.reader_email,
      header: copy.workspace.home.reader,
    },
    {
      id: "reader_user_id",
      accessorFn: (row) => edge(row)?.reader_user_id,
      header: copy.workspace.detail.readerUserId,
      enableSorting: false,
      cell: ({ row }) => {
        const value = edge(row.original)?.reader_user_id;
        return value ? (
          <span>
            {value}
            <CopyButton value={value} />
          </span>
        ) : null;
      },
    },
    {
      id: "reader_harness",
      accessorFn: (row) => edge(row)?.reader_harness,
      header: copy.workspace.fields.harness,
      enableSorting: false,
      cell: ({ row }) => {
        const value = edge(row.original);
        return value ? harnessLabel(value.reader_harness) : null;
      },
    },
    {
      id: "read_at",
      accessorFn: (row) => edge(row)?.read_at,
      header: copy.workspace.home.when,
      cell: ({ row }) => dateTime(edge(row.original)?.read_at),
    },
    {
      id: "truncated_fields",
      accessorFn: (row) => edge(row)?.truncated_fields,
      header: copy.workspace.fields.truncated_fields,
      enableSorting: false,
      cell: ({ row }) => (
        <ShortenedFields fields={edge(row.original)?.truncated_fields ?? []} />
      ),
    },
  ];
}
