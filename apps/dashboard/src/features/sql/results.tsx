import { formatSql } from "@agentcommons/core/format";
import type { JsonValue } from "@agentcommons/core/schemas/common";
import type { SqlOutput } from "@agentcommons/core/schemas/sql";
import { Download } from "lucide-react";
import { CopyButton } from "../../components/app/states";
import { Button } from "../../components/ui/button";
import { Alert } from "../../components/ui/feedback";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { copy } from "../../copy";
import { csvBlob, downloadBlob } from "../../lib/csv";
import { number, textValue } from "../../lib/display";
import { paths } from "../../lib/routes";
import { cn } from "../../lib/utils";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionColumn = (name: string) =>
  name === "session_id" || name.endsWith("_session_id");

function Cell({ column, value }: { column: string; value: JsonValue }) {
  if (value === null)
    return (
      <span className="text-xs text-subtle italic">
        {copy.sql.results.null}
      </span>
    );
  const text = textValue(value);
  if (sessionColumn(column) && typeof value === "string" && uuid.test(value))
    return (
      <a
        href={paths.session(value)}
        className="font-mono text-accent underline-offset-4 hover:underline"
        aria-label={`${copy.sql.results.openSession} ${value}`}
      >
        {value}
      </a>
    );
  return (
    <span
      className={cn(
        "line-clamp-4 max-w-[40rem] font-mono break-words whitespace-pre-wrap",
        typeof value === "number" && "tabular-nums",
      )}
      title={text.length > 120 ? text : undefined}
    >
      {text}
    </span>
  );
}

/** Row count, timing and notices above a sticky-header table that scrolls in its own box. */
export function SqlResults({ data }: { data: SqlOutput }) {
  const truncated = new Set(
    data.truncated_cells.map(([row, col]) => `${String(row)}:${String(col)}`),
  );
  const download = () => {
    downloadBlob(
      csvBlob(
        data.columns.map((column) => column.name),
        data.rows,
      ),
      copy.sql.results.csvName,
    );
  };
  return (
    <section
      data-testid="sql-results"
      aria-label={copy.sql.results.label}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">
            {number(data.row_count)}{" "}
            {data.row_count === 1
              ? copy.sql.results.row
              : copy.sql.results.rows}
          </span>
          <span className="text-xs text-muted">
            {number(Math.round(data.duration_ms))} {copy.sql.results.ms}
          </span>
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <CopyButton
            value={formatSql(data).text}
            label={copy.sql.results.copyText}
            showLabel
            variant="secondary"
            size="sm"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={download}
            disabled={data.rows.length === 0}
          >
            <Download aria-hidden />
            {copy.sql.results.csv}
          </Button>
        </div>
      </div>
      {data.capped && (
        <Alert variant="warning">{copy.sql.results.capped}</Alert>
      )}
      {data.truncated_cells.length > 0 && (
        <Alert variant="warning">{copy.sql.results.truncated}</Alert>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <Table
          containerClassName="app-scroll max-h-[60vh] overflow-auto"
          className="min-w-max"
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {data.columns.map((column, index) => (
                <TableHead
                  key={`${column.name}-${String(index)}`}
                  className="sticky top-0 z-10 bg-surface shadow-[inset_0_-1px_0_var(--line)]"
                >
                  <span className="flex flex-col leading-tight">
                    <span className="font-mono text-fg">{column.name}</span>
                    <span className="font-mono text-[10px] font-normal text-subtle">
                      {column.type}
                    </span>
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((value, columnIndex) => (
                  <TableCell
                    key={columnIndex}
                    className={cn(
                      "align-top text-[12.5px]",
                      truncated.has(
                        `${String(rowIndex)}:${String(columnIndex)}`,
                      ) && "bg-warning-bg/40",
                    )}
                  >
                    <Cell
                      column={data.columns[columnIndex]?.name ?? ""}
                      value={value}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
