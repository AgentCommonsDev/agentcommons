CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "Harness" AS ENUM ('CLAUDE_CODE', 'CODEX', 'GEMINI_CLI', 'PI');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ParentRelation" AS ENUM ('SUBAGENT', 'FORK', 'SPAWNED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL_RESULT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'THINKING', 'TOOL_USE', 'TOOL_RESULT', 'META');

-- CreateEnum
CREATE TYPE "PolicyKind" AS ENUM ('REGEX', 'SECRETLINT_RULE');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT,
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "impersonatedBy" TEXT,
    "activeOrganizationId" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apikey" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT,
    "start" TEXT,
    "referenceId" TEXT NOT NULL,
    "prefix" TEXT,
    "key" TEXT NOT NULL,
    "refillInterval" INTEGER,
    "refillAmount" INTEGER,
    "lastRefillAt" TIMESTAMP(3),
    "enabled" BOOLEAN DEFAULT true,
    "rateLimitEnabled" BOOLEAN DEFAULT true,
    "rateLimitTimeWindow" INTEGER DEFAULT 86400000,
    "rateLimitMax" INTEGER DEFAULT 10,
    "requestCount" INTEGER DEFAULT 0,
    "remaining" INTEGER,
    "lastRequest" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "permissions" TEXT,
    "metadata" TEXT,

    CONSTRAINT "apikey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "suspended" BOOLEAN DEFAULT false,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation" (
    "organization_id" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "os_user" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "arch" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_pkey" PRIMARY KEY ("organization_id","id")
);

-- CreateTable
CREATE TABLE "agent_session" (
    "organization_id" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "harness" "Harness" NOT NULL,
    "harness_session_id" TEXT NOT NULL,
    "harness_version" TEXT,
    "entrypoint" TEXT,
    "user_id" TEXT NOT NULL,
    "ingest_api_key_id" TEXT NOT NULL,
    "installation_id" UUID NOT NULL,
    "cwd" TEXT NOT NULL,
    "repo_root" TEXT,
    "cwd_relative" TEXT,
    "repo_url" TEXT,
    "repo_name" TEXT,
    "branch" TEXT,
    "start_commit" TEXT,
    "end_commit" TEXT,
    "observed_commits" JSONB,
    "observed_diff_stat" JSONB,
    "dirty_file_count" INTEGER,
    "model" TEXT,
    "models_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifecycle_pos" BIGINT NOT NULL DEFAULT -1,
    "lifecycle_at" TIMESTAMPTZ,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "end_reason" TEXT,
    "title" TEXT,
    "first_prompt" TEXT,
    "parent_session_id" UUID,
    "parent_relation" "ParentRelation",
    "parent_native_ref" TEXT,
    "agent_type" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "purged_at" TIMESTAMPTZ,
    "purged_by_user_id" TEXT,
    "purge_reason" TEXT,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "tool_call_count" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "tools_used" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "agent_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_file" (
    "organization_id" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "ops" TEXT[],

    CONSTRAINT "session_file_pkey" PRIMARY KEY ("session_id","path")
);

-- CreateTable
CREATE TABLE "raw_record" (
    "organization_id" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "source_version" INTEGER NOT NULL DEFAULT 0,
    "pos" BIGINT NOT NULL,
    "key" TEXT,
    "record_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ingest_batch_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "organization_id" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "raw_record_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "block_index" INTEGER NOT NULL,
    "role" "MessageRole" NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_name" TEXT,
    "tool_use_id" TEXT,
    "tool_input" JSONB,
    "model" TEXT,
    "timestamp" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "input_tokens" BIGINT,
    "output_tokens" BIGINT,
    "agent_id" TEXT,
    "searchable" BOOLEAN NOT NULL,
    "search_text" TEXT NOT NULL,
    "search_tsv" tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', search_text),
        CASE WHEN kind = 'TOOL_USE' THEN 'C' WHEN kind = 'TOOL_RESULT' THEN 'D' WHEN role = 'USER' THEN 'A' ELSE 'B' END::"char") ||
      setweight(to_tsvector('simple', search_text),
        CASE WHEN kind = 'TOOL_USE' THEN 'C' WHEN kind = 'TOOL_RESULT' THEN 'D' WHEN role = 'USER' THEN 'A' ELSE 'B' END::"char")
    ) STORED,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_batch" (
    "organization_id" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "installation_id" UUID NOT NULL,
    "ip" TEXT NOT NULL,
    "user_agent" TEXT,
    "cursor" TEXT NOT NULL,
    "accepted_count" INTEGER NOT NULL,
    "source_pos" BIGINT,
    "sent_at" TIMESTAMPTZ NOT NULL,
    "behavior" TEXT NOT NULL,
    "native_event" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "record_count" INTEGER NOT NULL,
    "duplicate_count" INTEGER NOT NULL,
    "byte_count" INTEGER NOT NULL,
    "redaction_count" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,

    CONSTRAINT "ingest_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redaction_event" (
    "organization_id" TEXT NOT NULL,
    "ingest_batch_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "redaction_event_pkey" PRIMARY KEY ("ingest_batch_id","session_id","policy_id")
);

-- CreateTable
CREATE TABLE "redaction_policy" (
    "organization_id" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PolicyKind" NOT NULL,
    "pattern" TEXT,
    "flags" TEXT,
    "rule_id" TEXT,
    "options" JSONB,
    "replacement" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "redaction_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "organization_id" TEXT,
    "id" UUID NOT NULL,
    "ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT,
    "api_key_id" TEXT,
    "auth_method" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "user_agent" TEXT,
    "transport" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status_code" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_chunk" (
    "organization_id" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,

    CONSTRAINT "message_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_embedding" (
    "organization_id" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "embedding" vector(1024) NOT NULL,

    CONSTRAINT "session_embedding_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "api_key_owner" (
    "key_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_owner_pkey" PRIMARY KEY ("key_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "apikey_configId_idx" ON "apikey"("configId");

-- CreateIndex
CREATE INDEX "apikey_referenceId_idx" ON "apikey"("referenceId");

-- CreateIndex
CREATE INDEX "apikey_key_idx" ON "apikey"("key");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE INDEX "agent_session_organization_id_idx" ON "agent_session"("organization_id");

-- CreateIndex
CREATE INDEX "agent_session_user_id_idx" ON "agent_session"("user_id");

-- CreateIndex
CREATE INDEX "agent_session_installation_id_idx" ON "agent_session"("installation_id");

-- CreateIndex
CREATE INDEX "agent_session_repo_name_idx" ON "agent_session"("repo_name");

-- CreateIndex
CREATE INDEX "agent_session_branch_idx" ON "agent_session"("branch");

-- CreateIndex
CREATE INDEX "agent_session_started_at_idx" ON "agent_session"("started_at" DESC);

-- CreateIndex
CREATE INDEX "agent_session_last_activity_at_idx" ON "agent_session"("last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "agent_session_parent_session_id_idx" ON "agent_session"("parent_session_id");

-- CreateIndex
CREATE INDEX "agent_session_visibility_idx" ON "agent_session"("visibility");

-- CreateIndex
CREATE INDEX "agent_session_status_idx" ON "agent_session"("status");

-- CreateIndex
CREATE INDEX "agent_session_repo_name_branch_started_at_idx" ON "agent_session"("repo_name", "branch", "started_at" DESC);

-- CreateIndex
CREATE INDEX "agent_session_tools_used_idx" ON "agent_session" USING GIN ("tools_used");

-- CreateIndex
CREATE UNIQUE INDEX "agent_session_organization_id_id_key" ON "agent_session"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_session_organization_id_harness_harness_session_id_key" ON "agent_session"("organization_id", "harness", "harness_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "raw_record_session_id_pos_source_version_key" ON "raw_record"("session_id", "pos", "source_version");

-- CreateIndex
CREATE UNIQUE INDEX "raw_record_organization_id_session_id_id_key" ON "raw_record"("organization_id", "session_id", "id");

-- CreateIndex
CREATE INDEX "message_session_id_seq_idx" ON "message"("session_id", "seq");

-- CreateIndex
CREATE INDEX "message_session_id_tool_use_id_idx" ON "message"("session_id", "tool_use_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_raw_record_id_block_index_key" ON "message"("raw_record_id", "block_index");

-- CreateIndex
CREATE UNIQUE INDEX "message_organization_id_session_id_id_key" ON "message"("organization_id", "session_id", "id");

-- CreateIndex
CREATE INDEX "ingest_batch_session_id_received_at_idx" ON "ingest_batch"("session_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_batch_organization_id_session_id_id_key" ON "ingest_batch"("organization_id", "session_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "redaction_policy_organization_id_name_key" ON "redaction_policy"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "redaction_policy_organization_id_id_key" ON "redaction_policy"("organization_id", "id");

-- CreateIndex
CREATE INDEX "audit_event_ts_idx" ON "audit_event"("ts" DESC);

-- CreateIndex
CREATE INDEX "audit_event_user_id_ts_idx" ON "audit_event"("user_id", "ts" DESC);

-- CreateIndex
CREATE INDEX "audit_event_action_ts_idx" ON "audit_event"("action", "ts" DESC);

-- CreateIndex
CREATE INDEX "message_chunk_session_id_idx" ON "message_chunk"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_chunk_message_id_ordinal_key" ON "message_chunk"("message_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "session_embedding_organization_id_session_id_key" ON "session_embedding"("organization_id", "session_id");

-- CreateIndex
CREATE INDEX "api_key_owner_organization_id_user_id_idx" ON "api_key_owner"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_owner_organization_id_key_id_key" ON "api_key_owner"("organization_id", "key_id");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_organization_id_installation_id_fkey" FOREIGN KEY ("organization_id", "installation_id") REFERENCES "installation"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_organization_id_parent_session_id_fkey" FOREIGN KEY ("organization_id", "parent_session_id") REFERENCES "agent_session"("organization_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "session_file" ADD CONSTRAINT "session_file_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "agent_session"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_record" ADD CONSTRAINT "raw_record_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "agent_session"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_record" ADD CONSTRAINT "raw_record_organization_id_session_id_ingest_batch_id_fkey" FOREIGN KEY ("organization_id", "session_id", "ingest_batch_id") REFERENCES "ingest_batch"("organization_id", "session_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "agent_session"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_organization_id_session_id_raw_record_id_fkey" FOREIGN KEY ("organization_id", "session_id", "raw_record_id") REFERENCES "raw_record"("organization_id", "session_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_batch" ADD CONSTRAINT "ingest_batch_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "agent_session"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_batch" ADD CONSTRAINT "ingest_batch_organization_id_installation_id_fkey" FOREIGN KEY ("organization_id", "installation_id") REFERENCES "installation"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redaction_event" ADD CONSTRAINT "redaction_event_organization_id_session_id_ingest_batch_id_fkey" FOREIGN KEY ("organization_id", "session_id", "ingest_batch_id") REFERENCES "ingest_batch"("organization_id", "session_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redaction_event" ADD CONSTRAINT "redaction_event_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "agent_session"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redaction_event" ADD CONSTRAINT "redaction_event_organization_id_policy_id_fkey" FOREIGN KEY ("organization_id", "policy_id") REFERENCES "redaction_policy"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_chunk" ADD CONSTRAINT "message_chunk_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "agent_session"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_chunk" ADD CONSTRAINT "message_chunk_organization_id_session_id_message_id_fkey" FOREIGN KEY ("organization_id", "session_id", "message_id") REFERENCES "message"("organization_id", "session_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_embedding" ADD CONSTRAINT "session_embedding_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "agent_session"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE UNIQUE INDEX "api_key_owner_organization_id_key_id_user_id_key" ON "api_key_owner"("organization_id", "key_id", "user_id");

-- SQL-only generated indexes and constraints; Better Auth models above are generated.
CREATE UNIQUE INDEX raw_record_session_key ON public.raw_record(session_id, key) WHERE key IS NOT NULL;
CREATE INDEX message_search ON public.message USING gin(search_tsv) WHERE searchable;
CREATE INDEX session_title_trigram ON public.agent_session USING gin(title gin_trgm_ops);
CREATE INDEX session_file_path_trigram ON public.session_file USING gin(path gin_trgm_ops);
CREATE INDEX message_chunk_cosine ON public.message_chunk USING hnsw(embedding vector_cosine_ops);
CREATE INDEX session_embedding_cosine ON public.session_embedding USING hnsw(embedding vector_cosine_ops);
ALTER TABLE public.message ADD CONSTRAINT message_nonnegative_seq CHECK (seq >= 0 AND block_index >= 0);
ALTER TABLE public.raw_record ADD CONSTRAINT record_nonnegative_position CHECK (pos >= 0 AND source_version >= 0);
ALTER TABLE public.audit_event ADD CONSTRAINT audit_detail_size CHECK (octet_length(detail::text) <= 8192);
ALTER TABLE public.agent_session ADD CONSTRAINT session_owner FOREIGN KEY(user_id) REFERENCES public."user"(id);
ALTER TABLE public.agent_session ADD CONSTRAINT session_ingest_owner FOREIGN KEY(organization_id,ingest_api_key_id,user_id) REFERENCES public.api_key_owner(organization_id,key_id,user_id);
ALTER TABLE public.ingest_batch ADD CONSTRAINT batch_owner FOREIGN KEY(user_id) REFERENCES public."user"(id);
ALTER TABLE public.ingest_batch ADD CONSTRAINT batch_key_owner FOREIGN KEY(organization_id,api_key_id,user_id) REFERENCES public.api_key_owner(organization_id,key_id,user_id);
ALTER TABLE public.api_key_owner ADD CONSTRAINT key_owner FOREIGN KEY(user_id) REFERENCES public."user"(id);
ALTER TABLE public.installation ADD CONSTRAINT installation_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.agent_session ADD CONSTRAINT agent_session_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.raw_record ADD CONSTRAINT raw_record_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.message ADD CONSTRAINT message_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.session_file ADD CONSTRAINT session_file_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.ingest_batch ADD CONSTRAINT ingest_batch_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.redaction_policy ADD CONSTRAINT redaction_policy_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.redaction_event ADD CONSTRAINT redaction_event_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.audit_event ADD CONSTRAINT audit_event_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.message_chunk ADD CONSTRAINT message_chunk_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.session_embedding ADD CONSTRAINT session_embedding_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);
ALTER TABLE public.api_key_owner ADD CONSTRAINT api_key_owner_organization FOREIGN KEY(organization_id) REFERENCES public.organization(id);

CREATE INDEX "audit_event_organization_id_ts_idx" ON "audit_event"("organization_id", "ts" DESC);

CREATE FUNCTION public.prevent_tenant_reassignment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Organization attribution is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['installation','agent_session','raw_record','message','session_file','ingest_batch','redaction_policy','redaction_event','audit_event','message_chunk','session_embedding','api_key_owner'] LOOP
    EXECUTE format('CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment()', table_name);
  END LOOP;
END $$;
