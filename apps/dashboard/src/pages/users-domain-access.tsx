import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { z } from "zod";
import {
  domainInputSchema,
  type domainOutputSchema,
} from "@agentcommons/core/schemas/auth";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { usePagination } from "../lib/pagination";
import { useWorkspace } from "../components/workspace/context";
import { DataTable } from "../components/workspace/data-table";
import {
  CopyButton,
  Field,
  RequestError,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";

type Domain = z.infer<typeof domainOutputSchema>;
const sorts = ["domain", "verified"] as const;
export function DomainAccess() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const page = usePagination("domain", sorts);
  const [domain, setDomain] = useState("");
  const [pendingProof, setPendingProof] = useState<Domain | null>(null);
  const [filter, setFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [verified, setVerified] = useState<"true" | "false" | undefined>();
  const params = {
    domain: appliedFilter,
    ...(verified ? { verified } : {}),
    sort: page.sort,
    order: page.direction,
  };
  const query = useQuery({
    queryKey: [organization.id, "domains", params, page.cursor],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/admin/domains", {
          params: {
            query: {
              ...params,
              ...(page.cursor ? { cursor: page.cursor } : {}),
              limit: 50,
            },
          },
          signal,
        }),
      ),
  });
  const mutation = useMutation({
    mutationFn: async (input: {
      operation: "register" | "verify";
      domain: string;
    }) =>
      input.operation === "register"
        ? unwrap(
            await api.POST("/api/v1/admin/domains", {
              body: { domain: input.domain },
            }),
          )
        : unwrap(
            await api.POST("/api/v1/admin/domains/verify", {
              body: { domain: input.domain },
            }),
          ),
    onSuccess: async (result) => {
      setPendingProof(result.verified ? null : result);
      await client.invalidateQueries({
        queryKey: [organization.id, "domains"],
      });
    },
  });
  const columns = useMemo<ColumnDef<Domain>[]>(
    () => [
      { accessorKey: "domain", header: copy.workspace.domains.domain },
      {
        accessorKey: "verified",
        header: copy.workspace.domains.status,
        cell: ({ row }) =>
          row.original.verified
            ? copy.workspace.domains.verified
            : copy.workspace.domains.pending,
      },
      {
        id: "actions",
        header: copy.workspace.common.actions,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          !row.original.verified && (
            <Button
              size="small"
              variant="secondary"
              disabled={mutation.isPending || !query.data?.enabled}
              onClick={() => {
                mutation.mutate({
                  operation: "register",
                  domain: row.original.domain,
                });
              }}
            >
              {copy.workspace.domains.showProof}
            </Button>
          ),
      },
    ],
    [mutation, query.data?.enabled],
  );
  const proof = pendingProof?.dns_record;
  return (
    <section
      className="workspace-panel"
      aria-label={copy.workspace.domains.title}
    >
      <h2>{copy.workspace.domains.title}</h2>
      <p>{copy.workspace.domains.description}</p>
      {query.data?.enabled === false && (
        <p role="status">{copy.workspace.domains.disabled}</p>
      )}
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({ operation: "register", domain });
        }}
      >
        <Field
          label={copy.workspace.domains.domain}
          hint={copy.workspace.domains.hint}
        >
          {(props) => (
            <input
              {...props}
              required
              maxLength={domainInputSchema.shape.domain.maxLength ?? undefined}
              placeholder={copy.workspace.domains.placeholder}
              value={domain}
              onChange={(event) => {
                setDomain(event.target.value);
              }}
              disabled={!query.data?.enabled}
            />
          )}
        </Field>
        <div className="form-actions">
          <Button
            type="submit"
            disabled={mutation.isPending || !query.data?.enabled}
          >
            {copy.workspace.domains.register}
          </Button>
        </div>
      </form>
      {mutation.error && <RequestError error={mutation.error} />}
      {mutation.data?.verified && (
        <p role="status">{copy.workspace.domains.success}</p>
      )}
      {proof && (
        <section
          className="workspace-panel"
          aria-label={copy.workspace.domains.proof}
        >
          <h3>{copy.workspace.domains.proof}</h3>
          <p>{copy.workspace.domains.proofDescription}</p>
          <Field label={copy.workspace.domains.recordName}>
            {(props) => <input {...props} readOnly value={proof.name} />}
          </Field>
          <CopyButton
            value={proof.name}
            label={copy.workspace.domains.copyName}
            showLabel
          />
          <Field label={copy.workspace.domains.recordValue}>
            {(props) => <input {...props} readOnly value={proof.value} />}
          </Field>
          <CopyButton
            value={proof.value}
            label={copy.workspace.domains.copyValue}
            showLabel
          />
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              mutation.mutate({
                operation: "verify",
                domain: pendingProof.domain,
              });
            }}
          >
            {copy.workspace.domains.verify}
          </Button>
        </section>
      )}
      <form
        className="filter-row"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedFilter(filter.trim());
          page.reset();
        }}
      >
        <Field label={copy.workspace.domains.domain}>
          {(props) => (
            <input
              {...props}
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={copy.workspace.domains.status}>
          {(props) => (
            <select
              {...props}
              value={verified ?? ""}
              onChange={(event) => {
                setVerified(
                  event.target.value === "true"
                    ? "true"
                    : event.target.value === "false"
                      ? "false"
                      : undefined,
                );
                page.reset();
              }}
            >
              <option value="">{copy.workspace.domains.all}</option>
              <option value="true">{copy.workspace.domains.verified}</option>
              <option value="false">{copy.workspace.domains.pending}</option>
            </select>
          )}
        </Field>
        <Button type="submit" variant="secondary">
          {copy.workspace.domains.filter}
        </Button>
      </form>
      {query.error ? (
        <RequestError error={query.error} />
      ) : (
        <DataTable
          data={query.data?.items ?? []}
          columns={columns}
          sorting={page.sorting}
          onSortingChange={page.onSortingChange}
          loading={query.isPending}
          nextCursor={query.data?.cursor ?? null}
          pageIndex={page.pageIndex}
          onNext={() => {
            page.next(query.data?.cursor ?? null);
          }}
          onPrevious={page.previous}
          label={copy.workspace.domains.title}
          csvName={copy.workspace.domains.csvName}
          fetchExportPage={async (cursor, signal) =>
            unwrap(
              await api.GET("/api/v1/admin/domains", {
                params: {
                  query: {
                    ...params,
                    ...(cursor ? { cursor } : {}),
                    limit: 100,
                  },
                },
                signal,
              }),
            )
          }
        />
      )}
    </section>
  );
}
