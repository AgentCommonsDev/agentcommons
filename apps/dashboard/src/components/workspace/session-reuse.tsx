import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { reuseSortKeys } from "@agentcommons/core/schemas/rest";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { usePagination } from "../../lib/pagination";
import { useWorkspace } from "./context";
import { Field, RequestError } from "./primitives";
import { DataTable } from "./data-table";
import { reuseColumns, type ReuseEdge } from "./reuse-columns";
import { Button } from "../ui/button";
function ReusePanel({
  sessionId,
  direction,
}: {
  sessionId: string;
  direction: "by" | "from";
}) {
  const { organization } = useWorkspace();
  const pagination = usePagination("read_at", reuseSortKeys);
  const [draft, setDraft] = useState("");
  const [reader, setReader] = useState("");
  const fetchPage = async (cursor: string | null, signal: AbortSignal) =>
    unwrap(
      await api.GET("/api/v1/sessions/{id}/reuse", {
        params: {
          path: { id: sessionId },
          query: {
            direction,
            limit: 25,
            cursor,
            sort: pagination.sort,
            order: pagination.direction,
            format: "json",
            ...(reader ? { reader_user_id: reader } : {}),
          },
        },
        signal,
      }),
    );
  const query = useQuery({
    queryKey: [
      organization.id,
      "session-reuse",
      sessionId,
      direction,
      reader,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: ({ signal }) => fetchPage(pagination.cursor, signal),
  });
  const title =
    copy.workspace.detail[direction === "by" ? "reusedBy" : "reusedFrom"];
  return (
    <section className="metric-section" aria-label={title}>
      <h2>{title}</h2>
      <form
        className="inline-admin-filter"
        onSubmit={(event) => {
          event.preventDefault();
          setReader(draft.trim());
          pagination.reset();
        }}
      >
        <Field label={copy.workspace.detail.readerUserId}>
          {(props) => (
            <input
              {...props}
              type="text"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary">
          {copy.workspace.common.apply}
        </Button>
      </form>
      {query.error ? (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <DataTable
          data={query.data?.items ?? []}
          columns={reuseColumns<ReuseEdge>((row) => row)}
          sorting={pagination.sorting}
          onSortingChange={pagination.onSortingChange}
          loading={query.isPending}
          nextCursor={query.data?.cursor ?? null}
          pageIndex={pagination.pageIndex}
          onNext={() => {
            pagination.next(query.data?.cursor ?? null);
          }}
          onPrevious={pagination.previous}
          label={title}
          csvName={`${direction}-${copy.workspace.detail.reuseCsvName}`}
          fetchExportPage={fetchPage}
        />
      )}
    </section>
  );
}
export function SessionReuse({ sessionId }: { sessionId: string }) {
  return (
    <>
      {(["by", "from"] as const).map((direction) => (
        <ReusePanel
          key={`${sessionId}-${direction}`}
          sessionId={sessionId}
          direction={direction}
        />
      ))}
    </>
  );
}
