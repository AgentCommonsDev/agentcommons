import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import type { z } from "zod";
import type * as schemas from "@agentcommons/core/schemas";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { useWorkspace } from "../../components/app/workspace";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { Badge } from "../../components/ui/badge";
import { Alert } from "../../components/ui/feedback";
import { RowMenu, type RowMenuItem } from "./row-menu";

export type ModerationSession = z.infer<typeof schemas.moderationSessionSchema>;
type Visibility = ModerationSession["visibility"];
/** What a moderation action needs to know; session headers and moderation rows both carry it. */
export interface ModerationTarget {
  session_id: string;
  visibility: Visibility;
  purged_at: string | null;
}
export type ModerationAction<
  Target extends ModerationTarget = ModerationTarget,
> =
  | { session: Target; kind: "visibility"; visibility: Visibility }
  | { session: Target; kind: "purge" };
const text = copy.admin.moderation;

/**
 * The moderation actions for one session, disabled where the state makes them moot: a
 * purged session keeps its visibility, and the current visibility is not offered again.
 */
export function moderationItems<Target extends ModerationTarget>(
  session: Target,
  onAction: (action: ModerationAction<Target>) => void,
): RowMenuItem[] {
  const purged = session.purged_at !== null;
  return [
    {
      label: text.visible,
      icon: Eye,
      disabled: purged || session.visibility === "PUBLIC",
      onSelect: () => {
        onAction({ session, kind: "visibility", visibility: "PUBLIC" });
      },
    },
    {
      label: text.private,
      icon: EyeOff,
      disabled: purged || session.visibility === "PRIVATE",
      onSelect: () => {
        onAction({ session, kind: "visibility", visibility: "PRIVATE" });
      },
    },
    {
      label: text.purge,
      icon: Trash2,
      destructive: true,
      disabled: purged,
      onSelect: () => {
        onAction({ session, kind: "purge" });
      },
    },
  ];
}
function describe(action: ModerationAction | null) {
  if (action?.kind === "purge")
    return {
      title: text.purgeTitle,
      description: text.purgeDescription,
      label: text.purge,
    };
  if (action?.visibility === "PRIVATE")
    return {
      title: text.privateTitle,
      description: text.privateDescription,
      label: text.private,
    };
  return {
    title: text.visibleTitle,
    description: text.visibleDescription,
    label: text.visible,
  };
}
/**
 * Confirms one moderation action with its audit reason, calls the admin route and
 * refreshes every query of the organization so lists and the session page show the
 * new state at once. The Moderation page and the session header share this dialog.
 */
export function ModerationDialog({
  action,
  onClose,
}: {
  action: ModerationAction | null;
  onClose: () => void;
}) {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const confirmation = describe(action);
  return (
    <ConfirmDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={confirmation.title}
      description={confirmation.description}
      confirmLabel={confirmation.label}
      destructive={action?.kind === "purge"}
      action={async (reason) => {
        if (!action) return;
        const params = { path: { id: action.session.session_id } };
        if (action.kind === "purge")
          unwrap(
            await api.POST("/api/v1/admin/sessions/{id}/purge", {
              params,
              body: { reason },
            }),
          );
        else
          unwrap(
            await api.POST("/api/v1/admin/sessions/{id}/visibility", {
              params,
              body: { visibility: action.visibility, reason },
            }),
          );
        await client.invalidateQueries({ queryKey: [organization.id] });
      }}
    >
      {action?.kind === "purge" && (
        <Alert variant="danger">{text.purgeWarning}</Alert>
      )}
    </ConfirmDialog>
  );
}
/** One session's moderation menu with its own confirmation, for the session page header. */
export function ModerationMenu({ session }: { session: ModerationTarget }) {
  const [action, setAction] = useState<ModerationAction | null>(null);
  return (
    <span data-testid="session-moderation">
      <RowMenu
        label={text.actions}
        showLabel
        items={moderationItems(session, setAction)}
      />
      <ModerationDialog
        action={action}
        onClose={() => {
          setAction(null);
        }}
      />
    </span>
  );
}
const publicationTone = {
  published: "success",
  queued: "neutral",
  waiting_source: "warning",
  failed: "danger",
} as const;
/**
 * Where a session's read model stands. A published session that is rebuilding a newer
 * revision still reads as published: members see it the whole time.
 */
export function PublicationBadge({
  session,
}: {
  session: Pick<ModerationSession, "published" | "projection_state">;
}) {
  const state = session.published ? "published" : session.projection_state;
  return (
    <Badge variant={publicationTone[state]}>{text.publication[state]}</Badge>
  );
}
