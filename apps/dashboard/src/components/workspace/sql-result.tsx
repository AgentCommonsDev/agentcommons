import { useMemo, useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import type { SqlOutput } from "@agentcommons/core/schemas/sql";
import type { JsonValue } from "@agentcommons/core/schemas/common";
import { formatSql } from "@agentcommons/core/format";
import { copy } from "../../copy";
import { number, textValue } from "../../lib/display";
import { DataTable } from "./data-table";
import { CopyButton } from "./primitives";
export function SqlResult({ data }: { data: SqlOutput }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = useMemo<ColumnDef<JsonValue[]>[]>(
    () =>
      data.columns.map((column, index) => ({
        id: String(index),
        header: column.name,
        accessorFn: (row) => row[index],
        enableSorting: false,
        cell: ({ getValue }) => textValue(getValue()),
      })),
    [data.columns],
  );
  return (
    <>
      <div className="sql-result-meta">
        <span>
          {number(data.row_count)}
          {copy.workspace.common.separator}
          {copy.workspace.common.rows}
        </span>
        <span>
          {number(data.duration_ms)}
          {copy.workspace.common.separator}
          {copy.workspace.fields.duration_ms}
        </span>
        <CopyButton value={formatSql(data).text} />
        {data.capped && <span>{copy.workspace.sql.capped}</span>}
        {data.truncated_cells.length > 0 && (
          <span>{copy.workspace.sql.truncated}</span>
        )}
      </div>
      <DataTable<JsonValue[]>
        data={data.rows}
        columns={columns}
        sorting={sorting}
        onSortingChange={setSorting}
        nextCursor={null}
        pageIndex={0}
        onNext={() => {}}
        onPrevious={() => {}}
        label={copy.workspace.sql.result}
        csvName={copy.workspace.sql.csvName}
        fetchExportPage={() =>
          Promise.resolve({ items: data.rows, cursor: null })
        }
      />
    </>
  );
}
