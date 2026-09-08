-- Fresh control plane. Traces, normalized messages, vectors and analytics live in ClickHouse.
-- Native Better Auth models are generated; pg-boss installs its own schema via migrate.ts.
CREATE ROLE ac_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
CREATE ROLE ac_trace_control LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
ALTER ROLE ac_trace_control SET default_transaction_read_only = on;
ALTER ROLE ac_trace_control SET statement_timeout = '5s';
ALTER ROLE ac_trace_control SET search_path = trace_control;

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Debian 16.14-1.pgdg12+1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: trace_control; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA trace_control;


--
-- Name: Harness; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Harness" AS ENUM (
    'CLAUDE_CODE',
    'CODEX',
    'GEMINI_CLI',
    'PI'
);


--
-- Name: ParentRelation; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ParentRelation" AS ENUM (
    'SUBAGENT',
    'FORK',
    'SPAWNED'
);


--
-- Name: PolicyKind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PolicyKind" AS ENUM (
    'REGEX',
    'SECRETLINT_RULE'
);


--
-- Name: SessionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SessionStatus" AS ENUM (
    'ACTIVE',
    'ENDED',
    'INACTIVE'
);


--
-- Name: Visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Visibility" AS ENUM (
    'PUBLIC',
    'PRIVATE'
);


--
-- Name: prevent_dashboard_owner_reassignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_dashboard_owner_reassignment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
  RAISE EXCEPTION 'Dashboard ownership is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;


--
-- Name: prevent_meter_payload_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_meter_payload_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF ROW(OLD.id,OLD.organization_id,OLD.subscription_id,OLD.customer_id,OLD.kind,OLD.event_name,OLD.quantity,OLD.occurred_at)
 IS DISTINCT FROM ROW(NEW.id,NEW.organization_id,NEW.subscription_id,NEW.customer_id,NEW.kind,NEW.event_name,NEW.quantity,NEW.occurred_at) THEN
 RAISE EXCEPTION 'billing event payload is immutable';
 END IF;
 RETURN NEW;
END $$;


--
-- Name: prevent_tenant_reassignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_tenant_reassignment() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Organization attribution is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp(3) without time zone,
    "refreshTokenExpiresAt" timestamp(3) without time zone,
    scope text,
    password text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: api_key_owner; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_key_owner (
    key_id text NOT NULL,
    organization_id text NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: apikey; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apikey (
    id text NOT NULL,
    "configId" text DEFAULT 'default'::text NOT NULL,
    name text,
    start text,
    "referenceId" text NOT NULL,
    prefix text,
    key text NOT NULL,
    "refillInterval" integer,
    "refillAmount" integer,
    "lastRefillAt" timestamp(3) without time zone,
    enabled boolean DEFAULT true,
    "rateLimitEnabled" boolean DEFAULT true,
    "rateLimitTimeWindow" integer DEFAULT 86400000,
    "rateLimitMax" integer DEFAULT 10,
    "requestCount" integer DEFAULT 0,
    remaining integer,
    "lastRequest" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    permissions text,
    metadata text
);


--
-- Name: audit_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_event (
    organization_id text,
    id uuid NOT NULL,
    ts timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    request_id text NOT NULL,
    user_id text,
    api_key_id text,
    auth_method text NOT NULL,
    ip text NOT NULL,
    user_agent text,
    transport text NOT NULL,
    action text NOT NULL,
    resource_type text,
    resource_ids text[] DEFAULT ARRAY[]::text[],
    status_code integer NOT NULL,
    duration_ms integer NOT NULL,
    detail jsonb NOT NULL,
    installation_id uuid,
    CONSTRAINT audit_detail_size CHECK ((octet_length((detail)::text) <= 8192)),
    CONSTRAINT audit_event_installation_scope CHECK (((installation_id IS NULL) OR (organization_id IS NOT NULL)))
);


--
-- Name: billing_meter_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_meter_event (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    subscription_id text NOT NULL,
    customer_id text NOT NULL,
    kind text NOT NULL,
    event_name text NOT NULL,
    quantity integer NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    first_dispatched_at timestamp with time zone,
    lease_until timestamp with time zone,
    delivered_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    failure_code text,
    CONSTRAINT billing_meter_event_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT billing_meter_event_kind_check CHECK ((kind = ANY (ARRAY['capture'::text, 'embedding'::text]))),
    CONSTRAINT billing_meter_event_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT billing_meter_event_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'delivered'::text, 'reconciliation_required'::text])))
);


--
-- Name: dashboard_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_profile (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    definition jsonb NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT dashboard_profile_revision_check CHECK ((revision >= 0))
);


--
-- Name: embedding_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embedding_attempt (
    organization_id text NOT NULL,
    id uuid NOT NULL,
    day date NOT NULL,
    purpose text NOT NULL,
    reserved_tokens integer NOT NULL,
    actual_tokens integer,
    state text DEFAULT 'reserved'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT embedding_attempt_purpose_check CHECK ((purpose = ANY (ARRAY['index'::text, 'query'::text]))),
    CONSTRAINT embedding_attempt_reserved_tokens_check CHECK ((reserved_tokens > 0)),
    CONSTRAINT embedding_attempt_state_check CHECK ((state = ANY (ARRAY['reserved'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: embedding_budget; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embedding_budget (
    organization_id text NOT NULL,
    day date NOT NULL,
    reserved_tokens bigint DEFAULT 0 NOT NULL,
    actual_tokens bigint DEFAULT 0 NOT NULL,
    cost_nano_dollars bigint DEFAULT 0 NOT NULL,
    CONSTRAINT embedding_budget_check CHECK (((actual_tokens >= 0) AND (actual_tokens <= reserved_tokens))),
    CONSTRAINT embedding_budget_cost_nano_dollars_check CHECK ((cost_nano_dollars >= 0)),
    CONSTRAINT embedding_budget_reserved_tokens_check CHECK ((reserved_tokens >= 0))
);


--
-- Name: embedding_deployment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embedding_deployment (
    id integer NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    dimensions integer NOT NULL,
    CONSTRAINT embedding_deployment_dimensions_check CHECK ((dimensions = 1024)),
    CONSTRAINT embedding_deployment_id_check CHECK ((id = 1)),
    CONSTRAINT embedding_deployment_provider_check CHECK ((provider = ANY (ARRAY['openai'::text, 'fake'::text])))
);


--
-- Name: embedding_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embedding_state (
    organization_id text NOT NULL,
    session_id uuid NOT NULL,
    source_digest text NOT NULL,
    complete boolean DEFAULT false NOT NULL,
    lease_token uuid,
    lease_until timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    vector_revision bigint NOT NULL
);


--
-- Name: embedding_state_vector_revision_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.embedding_state_vector_revision_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: embedding_state_vector_revision_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.embedding_state_vector_revision_seq OWNED BY public.embedding_state.vector_revision;


--
-- Name: installation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.installation (
    organization_id text NOT NULL,
    id uuid NOT NULL,
    hostname text NOT NULL,
    os_user text NOT NULL,
    platform text NOT NULL,
    arch text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tools_enabled boolean DEFAULT true NOT NULL
);


--
-- Name: invitation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    email text NOT NULL,
    role text,
    status text DEFAULT 'pending'::text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "inviterId" text NOT NULL
);


--
-- Name: member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    "createdAt" timestamp(3) without time zone NOT NULL,
    suspended boolean DEFAULT false,
    "removedAt" timestamp(3) without time zone
);


--
-- Name: organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo text,
    "createdAt" timestamp(3) without time zone NOT NULL,
    metadata text,
    "stripeCustomerId" text
);


--
-- Name: organization_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_settings (
    organization_id text NOT NULL,
    embeddings_enabled boolean DEFAULT false NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT organization_settings_revision_check CHECK ((revision >= 0))
);


--
-- Name: redaction_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redaction_event (
    organization_id text NOT NULL,
    ingest_batch_id uuid NOT NULL,
    session_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    count integer NOT NULL
);


--
-- Name: redaction_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redaction_policy (
    organization_id text NOT NULL,
    id uuid NOT NULL,
    name text NOT NULL,
    kind public."PolicyKind" NOT NULL,
    pattern text,
    flags text,
    rule_id text,
    options jsonb,
    replacement text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    builtin boolean DEFAULT false NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: redaction_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redaction_run (
    organization_id text NOT NULL,
    id uuid NOT NULL,
    state text DEFAULT 'queued'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    total_sessions integer NOT NULL,
    processed_sessions integer DEFAULT 0 NOT NULL,
    redaction_count integer DEFAULT 0 NOT NULL,
    error text,
    CONSTRAINT redaction_run_check CHECK (((processed_sessions >= 0) AND (processed_sessions <= total_sessions))),
    CONSTRAINT redaction_run_redaction_count_check CHECK ((redaction_count >= 0)),
    CONSTRAINT redaction_run_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT redaction_run_total_sessions_check CHECK ((total_sessions >= 0))
);


--
-- Name: TABLE redaction_run; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.redaction_run IS 'Organization-scoped rescan progress; pg-boss owns job delivery and retries.';


--
-- Name: redaction_run_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redaction_run_session (
    organization_id text NOT NULL,
    run_id uuid NOT NULL,
    session_id uuid NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: TABLE redaction_run_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.redaction_run_session IS 'Snapshot of rescan targets with atomic completion checkpoints; no transcript contents.';


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    id text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL,
    "impersonatedBy" text,
    "activeOrganizationId" text
);


--
-- Name: ssoProvider; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ssoProvider" (
    id text NOT NULL,
    issuer text NOT NULL,
    "oidcConfig" text,
    "samlConfig" text,
    "userId" text NOT NULL,
    "providerId" text NOT NULL,
    "organizationId" text,
    domain text NOT NULL,
    "domainVerified" boolean
);


--
-- Name: subscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription (
    id text NOT NULL,
    plan text NOT NULL,
    "referenceId" text NOT NULL,
    "stripeCustomerId" text,
    "stripeSubscriptionId" text,
    status text DEFAULT 'incomplete'::text NOT NULL,
    "periodStart" timestamp(3) without time zone,
    "periodEnd" timestamp(3) without time zone,
    "trialStart" timestamp(3) without time zone,
    "trialEnd" timestamp(3) without time zone,
    "cancelAtPeriodEnd" boolean DEFAULT false,
    "cancelAt" timestamp(3) without time zone,
    "canceledAt" timestamp(3) without time zone,
    "endedAt" timestamp(3) without time zone,
    seats integer,
    "billingInterval" text,
    "stripeScheduleId" text
);


--
-- Name: trace_analytics_retention; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trace_analytics_retention (
    id integer NOT NULL,
    retained_after timestamp with time zone NOT NULL,
    CONSTRAINT trace_analytics_retention_id_check CHECK ((id = 1))
);


--
-- Name: trace_audit_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trace_audit_outbox (
    audit_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trace_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trace_outbox (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    session_id uuid NOT NULL,
    revision bigint NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trace_outbox_kind_check CHECK ((kind = ANY (ARRAY['ingest'::text, 'rescan'::text, 'purge'::text, 'embedding'::text])))
);


--
-- Name: trace_receipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trace_receipt (
    organization_id text NOT NULL,
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    api_key_id text NOT NULL,
    user_id text NOT NULL,
    revision bigint NOT NULL,
    source_pos bigint NOT NULL,
    sent_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone NOT NULL,
    published_at timestamp with time zone,
    behavior text NOT NULL,
    native_event text NOT NULL,
    start_resume boolean NOT NULL,
    lifecycle_applied boolean NOT NULL,
    accepted_count integer NOT NULL,
    duplicate_count integer NOT NULL,
    record_count integer NOT NULL,
    byte_count bigint NOT NULL,
    redaction_count integer NOT NULL,
    duration_ms integer NOT NULL,
    cursor text NOT NULL
);


--
-- Name: trace_session_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trace_session_control (
    organization_id text NOT NULL,
    id uuid NOT NULL,
    harness public."Harness" NOT NULL,
    native_identity character varying(73) NOT NULL,
    harness_session_id text NOT NULL,
    user_id text NOT NULL,
    ingest_api_key_id text NOT NULL,
    installation_id uuid NOT NULL,
    accepted_revision bigint DEFAULT 0 NOT NULL,
    published_revision bigint DEFAULT 0 NOT NULL,
    redaction_generation bigint DEFAULT 0 NOT NULL,
    redaction_cleaned_generation bigint DEFAULT 0 NOT NULL,
    embedding_revision bigint,
    embedding_source_revision bigint,
    visibility public."Visibility" DEFAULT 'PUBLIC'::public."Visibility" NOT NULL,
    status public."SessionStatus" DEFAULT 'ACTIVE'::public."SessionStatus" NOT NULL,
    lifecycle_pos bigint,
    lifecycle_at timestamp with time zone,
    context_pos bigint,
    context_at timestamp with time zone,
    normalizer_context jsonb DEFAULT '{}'::jsonb NOT NULL,
    projected_context jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    last_activity_at timestamp with time zone NOT NULL,
    parent_session_id uuid,
    parent_relation public."ParentRelation",
    parent_native_ref text,
    purged_at timestamp with time zone,
    purged_by_user_id text,
    purge_reason text,
    purge_manifest jsonb,
    purge_completed_at timestamp with time zone,
    projection_lease uuid,
    projection_lease_until timestamp with time zone,
    projection_state text DEFAULT 'queued'::text NOT NULL,
    projection_error text,
    projection_attempt_at timestamp with time zone,
    CONSTRAINT trace_session_control_check CHECK (((published_revision >= 0) AND (accepted_revision >= published_revision))),
    CONSTRAINT trace_session_control_check1 CHECK (((embedding_source_revision IS NULL) OR (embedding_source_revision <= published_revision))),
    CONSTRAINT trace_session_control_projection_state_check CHECK ((projection_state = ANY (ARRAY['queued'::text, 'waiting_source'::text, 'failed'::text, 'published'::text]))),
    CONSTRAINT trace_session_control_redaction_generation_check CHECK ((redaction_generation >= 0))
);


--
-- Name: trace_source_admission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trace_source_admission (
    organization_id text NOT NULL,
    session_id uuid NOT NULL,
    source_identity character varying(64) NOT NULL,
    raw_record_id uuid NOT NULL,
    pos bigint NOT NULL,
    source_version integer NOT NULL,
    introduced_revision bigint NOT NULL,
    received_at timestamp with time zone NOT NULL,
    CONSTRAINT trace_source_admission_pos_check CHECK ((pos >= 0)),
    CONSTRAINT trace_source_admission_source_identity_check CHECK (((source_identity)::text ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT trace_source_admission_source_version_check CHECK ((source_version >= 0))
);


--
-- Name: trace_tool_call_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trace_tool_call_control (
    organization_id text NOT NULL,
    session_id uuid NOT NULL,
    id_hash character varying(64) NOT NULL,
    sensitive boolean NOT NULL,
    CONSTRAINT trace_tool_call_control_id_hash_check CHECK (((id_hash)::text ~ '^[a-f0-9]{64}$'::text))
);


--
-- Name: usage_admission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_admission (
    organization_id text NOT NULL,
    kind text NOT NULL,
    resource_id uuid NOT NULL,
    admitted_at timestamp with time zone NOT NULL,
    subscription_id text,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    CONSTRAINT usage_admission_check CHECK ((period_end > period_start)),
    CONSTRAINT usage_admission_kind_check CHECK ((kind = ANY (ARRAY['capture'::text, 'embedding'::text])))
);


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean DEFAULT false NOT NULL,
    image text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    role text,
    banned boolean DEFAULT false,
    "banReason" text,
    "banExpires" timestamp(3) without time zone,
    "onboardingOrganizationId" text,
    "stripeCustomerId" text,
    "welcomeQueuedAt" timestamp(3) without time zone
);


--
-- Name: verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: audit_retention; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.audit_retention WITH (security_barrier='true') AS
 SELECT id,
    retained_after
   FROM public.trace_analytics_retention;


--
-- Name: installation_scope; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.installation_scope WITH (security_barrier='true') AS
 SELECT c.organization_id,
    c.installation_id AS id,
    1 AS present,
    (bool_or(((c.visibility = 'PUBLIC'::public."Visibility") AND (c.purged_at IS NULL))))::integer AS visible,
    i.hostname
   FROM (public.trace_session_control c
     JOIN public.installation i ON (((i.organization_id = c.organization_id) AND (i.id = c.installation_id))))
  WHERE (c.published_revision > 0)
  GROUP BY c.organization_id, c.installation_id, i.hostname;


--
-- Name: installations; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.installations WITH (security_barrier='true') AS
 SELECT organization_id,
    id,
    hostname,
    os_user,
    platform,
    arch,
    (tools_enabled)::integer AS tools_enabled,
    first_seen_at,
    last_seen_at
   FROM public.installation;


--
-- Name: metrics_health; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.metrics_health WITH (security_barrier='true') AS
 SELECT s.organization_id,
    s.id AS session_id,
    (((k.id IS NULL) OR (k.enabled IS NOT TRUE) OR ((k."expiresAt" IS NOT NULL) AND (k."expiresAt" <= now())) OR (NOT COALESCE((((k.permissions)::jsonb -> 'sessions'::text) ? 'ingest'::text), false)) OR (m.id IS NULL) OR (m.suspended IS TRUE) OR (u.banned IS TRUE)))::integer AS authorization_blocked
   FROM (((public.trace_session_control s
     LEFT JOIN public.apikey k ON ((k.id = s.ingest_api_key_id)))
     LEFT JOIN public.member m ON (((m."organizationId" = s.organization_id) AND (m."userId" = s.user_id))))
     LEFT JOIN public."user" u ON ((u.id = s.user_id)));


--
-- Name: metrics_members; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.metrics_members WITH (security_barrier='true') AS
 SELECT m."organizationId" AS organization_id,
    count(*) AS member_count
   FROM (public.member m
     JOIN public."user" u ON ((u.id = m."userId")))
  WHERE ((m.suspended IS NOT TRUE) AND (u.banned IS NOT TRUE))
  GROUP BY m."organizationId";


--
-- Name: organization_settings; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.organization_settings WITH (security_barrier='true') AS
 SELECT organization_id,
    (embeddings_enabled)::integer AS embeddings_enabled,
    ((EXISTS ( SELECT 1
           FROM public.subscription p
          WHERE ((p."referenceId" = c.organization_id) AND (p.plan = 'pro_embeddings'::text) AND (p.status = 'active'::text) AND (p."stripeSubscriptionId" IS NOT NULL) AND (p."periodStart" <= now()) AND (p."periodEnd" > now())))))::integer AS paid_embeddings
   FROM public.organization_settings c;


--
-- Name: session_scope; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.session_scope WITH (security_barrier='true') AS
 SELECT c.organization_id,
    c.id AS session_id,
    c.published_revision,
    c.redaction_generation,
    (((c.visibility = 'PUBLIC'::public."Visibility") AND (c.purged_at IS NULL)))::integer AS visible,
    ((c.purged_at IS NOT NULL))::integer AS purged,
    COALESCE(c.embedding_revision, (0)::bigint) AS embedding_revision,
    COALESCE(c.embedding_source_revision, (0)::bigint) AS embedding_source_revision,
    COALESCE(s.embeddings_enabled, 0) AS embeddings_enabled,
    COALESCE(s.paid_embeddings, 0) AS paid_embeddings,
    c.parent_session_id,
    (c.parent_relation)::text AS parent_relation,
    c.parent_native_ref,
    (c.status)::text AS status,
    c.ended_at,
    c.last_activity_at,
    (c.visibility)::text AS visibility,
    c.purged_at,
    c.user_id,
    (c.harness)::text AS harness,
    c.harness_session_id,
    c.ingest_api_key_id,
    c.installation_id,
    c.started_at
   FROM (public.trace_session_control c
     LEFT JOIN trace_control.organization_settings s ON ((s.organization_id = c.organization_id)));


--
-- Name: sessions; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.sessions WITH (security_barrier='true') AS
 SELECT organization_id,
    id AS session_id,
    published_revision,
    redaction_generation,
    user_id,
    (visibility)::text AS visibility,
    purged_at,
    embedding_revision,
    embedding_source_revision,
    parent_session_id,
    (parent_relation)::text AS parent_relation,
    parent_native_ref,
    (status)::text AS status,
    ended_at,
    last_activity_at,
    (harness)::text AS harness,
    harness_session_id,
    ingest_api_key_id,
    installation_id,
    started_at
   FROM public.trace_session_control;


--
-- Name: user_scope; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.user_scope WITH (security_barrier='true') AS
 SELECT c.organization_id,
    c.user_id AS id,
    1 AS present,
    (bool_or(((c.visibility = 'PUBLIC'::public."Visibility") AND (c.purged_at IS NULL))))::integer AS visible,
    u.email,
    u.name
   FROM (public.trace_session_control c
     JOIN public."user" u ON ((u.id = c.user_id)))
  WHERE (c.published_revision > 0)
  GROUP BY c.organization_id, c.user_id, u.email, u.name;


--
-- Name: users; Type: VIEW; Schema: trace_control; Owner: -
--

CREATE VIEW trace_control.users WITH (security_barrier='true') AS
 SELECT u.id,
    u.email,
    u.name,
    m."organizationId" AS organization_id
   FROM (public."user" u
     JOIN public.member m ON ((m."userId" = u.id)));


--
-- Name: embedding_state vector_revision; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_state ALTER COLUMN vector_revision SET DEFAULT nextval('public.embedding_state_vector_revision_seq'::regclass);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: api_key_owner api_key_owner_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_owner
    ADD CONSTRAINT api_key_owner_pkey PRIMARY KEY (key_id);


--
-- Name: apikey apikey_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apikey
    ADD CONSTRAINT apikey_pkey PRIMARY KEY (id);


--
-- Name: audit_event audit_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT audit_event_pkey PRIMARY KEY (id);


--
-- Name: billing_meter_event billing_meter_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_meter_event
    ADD CONSTRAINT billing_meter_event_pkey PRIMARY KEY (id);


--
-- Name: dashboard_profile dashboard_profile_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_profile
    ADD CONSTRAINT dashboard_profile_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: dashboard_profile dashboard_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_profile
    ADD CONSTRAINT dashboard_profile_pkey PRIMARY KEY (id);


--
-- Name: embedding_attempt embedding_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_attempt
    ADD CONSTRAINT embedding_attempt_pkey PRIMARY KEY (id);


--
-- Name: embedding_budget embedding_budget_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_budget
    ADD CONSTRAINT embedding_budget_pkey PRIMARY KEY (organization_id, day);


--
-- Name: embedding_deployment embedding_deployment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_deployment
    ADD CONSTRAINT embedding_deployment_pkey PRIMARY KEY (id);


--
-- Name: embedding_state embedding_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_state
    ADD CONSTRAINT embedding_state_pkey PRIMARY KEY (organization_id, session_id);


--
-- Name: installation installation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installation
    ADD CONSTRAINT installation_pkey PRIMARY KEY (organization_id, id);


--
-- Name: invitation invitation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_pkey PRIMARY KEY (id);


--
-- Name: member member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member
    ADD CONSTRAINT member_pkey PRIMARY KEY (id);


--
-- Name: organization organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_pkey PRIMARY KEY (id);


--
-- Name: organization_settings organization_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_pkey PRIMARY KEY (organization_id);


--
-- Name: redaction_event redaction_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_event
    ADD CONSTRAINT redaction_event_pkey PRIMARY KEY (ingest_batch_id, session_id, policy_id);


--
-- Name: redaction_policy redaction_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_policy
    ADD CONSTRAINT redaction_policy_pkey PRIMARY KEY (id);


--
-- Name: redaction_run redaction_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_run
    ADD CONSTRAINT redaction_run_pkey PRIMARY KEY (organization_id, id);


--
-- Name: redaction_run_session redaction_run_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_run_session
    ADD CONSTRAINT redaction_run_session_pkey PRIMARY KEY (organization_id, run_id, session_id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: ssoProvider ssoProvider_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ssoProvider"
    ADD CONSTRAINT "ssoProvider_pkey" PRIMARY KEY (id);


--
-- Name: subscription subscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription
    ADD CONSTRAINT subscription_pkey PRIMARY KEY (id);


--
-- Name: trace_analytics_retention trace_analytics_retention_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_analytics_retention
    ADD CONSTRAINT trace_analytics_retention_pkey PRIMARY KEY (id);


--
-- Name: trace_audit_outbox trace_audit_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_audit_outbox
    ADD CONSTRAINT trace_audit_outbox_pkey PRIMARY KEY (audit_id);


--
-- Name: trace_outbox trace_outbox_organization_id_session_id_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_outbox
    ADD CONSTRAINT trace_outbox_organization_id_session_id_revision_key UNIQUE (organization_id, session_id, revision);


--
-- Name: trace_outbox trace_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_outbox
    ADD CONSTRAINT trace_outbox_pkey PRIMARY KEY (id);


--
-- Name: trace_receipt trace_receipt_organization_id_session_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_receipt
    ADD CONSTRAINT trace_receipt_organization_id_session_id_id_key UNIQUE (organization_id, session_id, id);


--
-- Name: trace_receipt trace_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_receipt
    ADD CONSTRAINT trace_receipt_pkey PRIMARY KEY (organization_id, id);


--
-- Name: trace_session_control trace_session_control_organization_id_harness_native_identi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_session_control
    ADD CONSTRAINT trace_session_control_organization_id_harness_native_identi_key UNIQUE (organization_id, harness, native_identity);


--
-- Name: trace_session_control trace_session_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_session_control
    ADD CONSTRAINT trace_session_control_pkey PRIMARY KEY (organization_id, id);


--
-- Name: trace_source_admission trace_source_admission_organization_id_raw_record_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_source_admission
    ADD CONSTRAINT trace_source_admission_organization_id_raw_record_id_key UNIQUE (organization_id, raw_record_id);


--
-- Name: trace_source_admission trace_source_admission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_source_admission
    ADD CONSTRAINT trace_source_admission_pkey PRIMARY KEY (organization_id, session_id, source_identity);


--
-- Name: trace_tool_call_control trace_tool_call_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_tool_call_control
    ADD CONSTRAINT trace_tool_call_control_pkey PRIMARY KEY (organization_id, session_id, id_hash);


--
-- Name: usage_admission usage_admission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_admission
    ADD CONSTRAINT usage_admission_pkey PRIMARY KEY (organization_id, kind, resource_id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: account_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "account_userId_idx" ON public.account USING btree ("userId");


--
-- Name: api_key_owner_organization_id_key_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX api_key_owner_organization_id_key_id_key ON public.api_key_owner USING btree (organization_id, key_id);


--
-- Name: api_key_owner_organization_id_key_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX api_key_owner_organization_id_key_id_user_id_key ON public.api_key_owner USING btree (organization_id, key_id, user_id);


--
-- Name: api_key_owner_organization_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_key_owner_organization_id_user_id_idx ON public.api_key_owner USING btree (organization_id, user_id);


--
-- Name: apikey_configId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "apikey_configId_idx" ON public.apikey USING btree ("configId");


--
-- Name: apikey_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX apikey_key_idx ON public.apikey USING btree (key);


--
-- Name: apikey_referenceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "apikey_referenceId_idx" ON public.apikey USING btree ("referenceId");


--
-- Name: audit_event_action_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_event_action_ts_idx ON public.audit_event USING btree (action, ts DESC);


--
-- Name: audit_event_organization_id_installation_id_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_event_organization_id_installation_id_ts_idx ON public.audit_event USING btree (organization_id, installation_id, ts DESC);


--
-- Name: audit_event_organization_id_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_event_organization_id_ts_idx ON public.audit_event USING btree (organization_id, ts DESC);


--
-- Name: audit_event_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_event_ts_idx ON public.audit_event USING btree (ts DESC);


--
-- Name: audit_event_user_id_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_event_user_id_ts_idx ON public.audit_event USING btree (user_id, ts DESC);


--
-- Name: billing_meter_event_organization_id_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_meter_event_organization_id_state_idx ON public.billing_meter_event USING btree (organization_id, state);


--
-- Name: billing_meter_event_state_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_meter_event_state_occurred_at_idx ON public.billing_meter_event USING btree (state, occurred_at);


--
-- Name: dashboard_profile_organization_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_profile_organization_id_user_id_idx ON public.dashboard_profile USING btree (organization_id, user_id);


--
-- Name: embedding_attempt_organization_id_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX embedding_attempt_organization_id_day_idx ON public.embedding_attempt USING btree (organization_id, day);


--
-- Name: invitation_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitation_email_idx ON public.invitation USING btree (email);


--
-- Name: invitation_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "invitation_organizationId_idx" ON public.invitation USING btree ("organizationId");


--
-- Name: member_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "member_organizationId_idx" ON public.member USING btree ("organizationId");


--
-- Name: member_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "member_userId_idx" ON public.member USING btree ("userId");


--
-- Name: organization_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_slug_key ON public.organization USING btree (slug);


--
-- Name: redaction_policy_organization_id_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redaction_policy_organization_id_id_key ON public.redaction_policy USING btree (organization_id, id);


--
-- Name: redaction_policy_organization_id_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redaction_policy_organization_id_name_key ON public.redaction_policy USING btree (organization_id, name);


--
-- Name: session_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX session_token_key ON public.session USING btree (token);


--
-- Name: session_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_userId_idx" ON public.session USING btree ("userId");


--
-- Name: ssoProvider_providerId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ssoProvider_providerId_key" ON public."ssoProvider" USING btree ("providerId");


--
-- Name: trace_audit_outbox_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trace_audit_outbox_created_at_idx ON public.trace_audit_outbox USING btree (created_at, audit_id);


--
-- Name: trace_outbox_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trace_outbox_created_at_idx ON public.trace_outbox USING btree (created_at);


--
-- Name: trace_receipt_organization_id_api_key_id_received_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trace_receipt_organization_id_api_key_id_received_at_idx ON public.trace_receipt USING btree (organization_id, api_key_id, received_at);


--
-- Name: trace_receipt_organization_id_session_id_source_pos_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trace_receipt_organization_id_session_id_source_pos_idx ON public.trace_receipt USING btree (organization_id, session_id, source_pos);


--
-- Name: trace_session_control_organization_id_published_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trace_session_control_organization_id_published_revision_idx ON public.trace_session_control USING btree (organization_id, published_revision);


--
-- Name: usage_admission_organization_id_kind_period_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_admission_organization_id_kind_period_start_idx ON public.usage_admission USING btree (organization_id, kind, period_start);


--
-- Name: user_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_email_key ON public."user" USING btree (email);


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);


--
-- Name: billing_meter_event immutable_payload; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_payload BEFORE UPDATE ON public.billing_meter_event FOR EACH ROW EXECUTE FUNCTION public.prevent_meter_payload_change();


--
-- Name: dashboard_profile owner_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER owner_immutable BEFORE UPDATE OF user_id ON public.dashboard_profile FOR EACH ROW EXECUTE FUNCTION public.prevent_dashboard_owner_reassignment();


--
-- Name: api_key_owner tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.api_key_owner FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: audit_event tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: dashboard_profile tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.dashboard_profile FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: embedding_attempt tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.embedding_attempt FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: embedding_budget tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.embedding_budget FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: embedding_state tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.embedding_state FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: installation tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.installation FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: organization_settings tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.organization_settings FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: redaction_event tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.redaction_event FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: redaction_policy tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.redaction_policy FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: redaction_run tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.redaction_run FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: redaction_run_session tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.redaction_run_session FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: trace_receipt tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.trace_receipt FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: trace_session_control tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.trace_session_control FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: trace_tool_call_control tenant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.trace_tool_call_control FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();


--
-- Name: account account_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: api_key_owner api_key_owner_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_owner
    ADD CONSTRAINT api_key_owner_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: audit_event audit_event_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT audit_event_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: audit_event audit_event_organization_id_installation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT audit_event_organization_id_installation_id_fkey FOREIGN KEY (organization_id, installation_id) REFERENCES public.installation(organization_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: billing_meter_event billing_meter_event_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_meter_event
    ADD CONSTRAINT billing_meter_event_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: dashboard_profile dashboard_profile_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_profile
    ADD CONSTRAINT dashboard_profile_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: dashboard_profile dashboard_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_profile
    ADD CONSTRAINT dashboard_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: embedding_attempt embedding_attempt_organization_id_day_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_attempt
    ADD CONSTRAINT embedding_attempt_organization_id_day_fkey FOREIGN KEY (organization_id, day) REFERENCES public.embedding_budget(organization_id, day) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: embedding_budget embedding_budget_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_budget
    ADD CONSTRAINT embedding_budget_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: embedding_state embedding_state_organization_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_state
    ADD CONSTRAINT embedding_state_organization_id_session_id_fkey FOREIGN KEY (organization_id, session_id) REFERENCES public.trace_session_control(organization_id, id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: installation installation_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installation
    ADD CONSTRAINT installation_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: invitation invitation_inviterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: invitation invitation_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organization(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: api_key_owner key_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_owner
    ADD CONSTRAINT key_owner FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: member member_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member
    ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organization(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: member member_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member
    ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organization_settings organization_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: redaction_event redaction_event_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_event
    ADD CONSTRAINT redaction_event_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: redaction_event redaction_event_organization_id_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_event
    ADD CONSTRAINT redaction_event_organization_id_policy_id_fkey FOREIGN KEY (organization_id, policy_id) REFERENCES public.redaction_policy(organization_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: redaction_event redaction_event_organization_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_event
    ADD CONSTRAINT redaction_event_organization_id_session_id_fkey FOREIGN KEY (organization_id, session_id) REFERENCES public.trace_session_control(organization_id, id) ON DELETE CASCADE;


--
-- Name: redaction_event redaction_event_organization_id_session_id_ingest_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_event
    ADD CONSTRAINT redaction_event_organization_id_session_id_ingest_batch_id_fkey FOREIGN KEY (organization_id, session_id, ingest_batch_id) REFERENCES public.trace_receipt(organization_id, session_id, id);


--
-- Name: redaction_policy redaction_policy_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_policy
    ADD CONSTRAINT redaction_policy_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: redaction_run redaction_run_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_run
    ADD CONSTRAINT redaction_run_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: redaction_run_session redaction_run_session_run_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_run_session
    ADD CONSTRAINT redaction_run_session_run_fkey FOREIGN KEY (organization_id, run_id) REFERENCES public.redaction_run(organization_id, id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: redaction_run_session redaction_run_session_session_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redaction_run_session
    ADD CONSTRAINT redaction_run_session_session_fkey FOREIGN KEY (organization_id, session_id) REFERENCES public.trace_session_control(organization_id, id);


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ssoProvider ssoProvider_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ssoProvider"
    ADD CONSTRAINT "ssoProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: trace_audit_outbox trace_audit_outbox_audit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_audit_outbox
    ADD CONSTRAINT trace_audit_outbox_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audit_event(id) ON DELETE CASCADE;


--
-- Name: trace_outbox trace_outbox_organization_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_outbox
    ADD CONSTRAINT trace_outbox_organization_id_session_id_fkey FOREIGN KEY (organization_id, session_id) REFERENCES public.trace_session_control(organization_id, id);


--
-- Name: trace_receipt trace_receipt_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_receipt
    ADD CONSTRAINT trace_receipt_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.apikey(id);


--
-- Name: trace_receipt trace_receipt_key_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_receipt
    ADD CONSTRAINT trace_receipt_key_owner FOREIGN KEY (organization_id, api_key_id, user_id) REFERENCES public.api_key_owner(organization_id, key_id, user_id);


--
-- Name: trace_receipt trace_receipt_organization_id_installation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_receipt
    ADD CONSTRAINT trace_receipt_organization_id_installation_id_fkey FOREIGN KEY (organization_id, installation_id) REFERENCES public.installation(organization_id, id);


--
-- Name: trace_receipt trace_receipt_organization_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_receipt
    ADD CONSTRAINT trace_receipt_organization_id_session_id_fkey FOREIGN KEY (organization_id, session_id) REFERENCES public.trace_session_control(organization_id, id);


--
-- Name: trace_receipt trace_receipt_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_receipt
    ADD CONSTRAINT trace_receipt_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: trace_session_control trace_session_control_ingest_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_session_control
    ADD CONSTRAINT trace_session_control_ingest_api_key_id_fkey FOREIGN KEY (ingest_api_key_id) REFERENCES public.apikey(id);


--
-- Name: trace_session_control trace_session_control_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_session_control
    ADD CONSTRAINT trace_session_control_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: trace_session_control trace_session_control_organization_id_installation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_session_control
    ADD CONSTRAINT trace_session_control_organization_id_installation_id_fkey FOREIGN KEY (organization_id, installation_id) REFERENCES public.installation(organization_id, id);


--
-- Name: trace_session_control trace_session_control_organization_id_parent_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_session_control
    ADD CONSTRAINT trace_session_control_organization_id_parent_session_id_fkey FOREIGN KEY (organization_id, parent_session_id) REFERENCES public.trace_session_control(organization_id, id);


--
-- Name: trace_session_control trace_session_control_purged_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_session_control
    ADD CONSTRAINT trace_session_control_purged_by_user_id_fkey FOREIGN KEY (purged_by_user_id) REFERENCES public."user"(id);


--
-- Name: trace_session_control trace_session_control_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_session_control
    ADD CONSTRAINT trace_session_control_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: trace_session_control trace_session_ingest_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_session_control
    ADD CONSTRAINT trace_session_ingest_owner FOREIGN KEY (organization_id, ingest_api_key_id, user_id) REFERENCES public.api_key_owner(organization_id, key_id, user_id);


--
-- Name: trace_source_admission trace_source_admission_organization_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_source_admission
    ADD CONSTRAINT trace_source_admission_organization_id_session_id_fkey FOREIGN KEY (organization_id, session_id) REFERENCES public.trace_session_control(organization_id, id);


--
-- Name: trace_tool_call_control trace_tool_call_control_organization_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_tool_call_control
    ADD CONSTRAINT trace_tool_call_control_organization_id_session_id_fkey FOREIGN KEY (organization_id, session_id) REFERENCES public.trace_session_control(organization_id, id);


--
-- Name: usage_admission usage_admission_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_admission
    ADD CONSTRAINT usage_admission_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO ac_app;


--
-- Name: SCHEMA trace_control; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA trace_control TO ac_trace_control;


--
-- Name: TABLE account; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account TO ac_app;


--
-- Name: TABLE api_key_owner; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.api_key_owner TO ac_app;


--
-- Name: TABLE apikey; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.apikey TO ac_app;


--
-- Name: TABLE audit_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE public.audit_event TO ac_app;


--
-- Name: TABLE billing_meter_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.billing_meter_event TO ac_app;


--
-- Name: TABLE dashboard_profile; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dashboard_profile TO ac_app;


--
-- Name: TABLE embedding_attempt; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.embedding_attempt TO ac_app;


--
-- Name: TABLE embedding_budget; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.embedding_budget TO ac_app;


--
-- Name: TABLE embedding_deployment; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.embedding_deployment TO ac_app;


--
-- Name: TABLE embedding_state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.embedding_state TO ac_app;


--
-- Name: SEQUENCE embedding_state_vector_revision_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.embedding_state_vector_revision_seq TO ac_app;


--
-- Name: TABLE installation; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.installation TO ac_app;


--
-- Name: TABLE invitation; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invitation TO ac_app;


--
-- Name: TABLE member; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.member TO ac_app;


--
-- Name: TABLE organization; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organization TO ac_app;


--
-- Name: TABLE organization_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organization_settings TO ac_app;


--
-- Name: TABLE redaction_event; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.redaction_event TO ac_app;


--
-- Name: TABLE redaction_policy; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.redaction_policy TO ac_app;


--
-- Name: TABLE redaction_run; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.redaction_run TO ac_app;


--
-- Name: TABLE redaction_run_session; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.redaction_run_session TO ac_app;


--
-- Name: TABLE session; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.session TO ac_app;


--
-- Name: TABLE "ssoProvider"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."ssoProvider" TO ac_app;


--
-- Name: TABLE subscription; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscription TO ac_app;


--
-- Name: TABLE trace_analytics_retention; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,UPDATE ON TABLE public.trace_analytics_retention TO ac_app;


--
-- Name: TABLE trace_audit_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE public.trace_audit_outbox TO ac_app;


--
-- Name: TABLE trace_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE public.trace_outbox TO ac_app;


--
-- Name: TABLE trace_receipt; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.trace_receipt TO ac_app;


--
-- Name: TABLE trace_session_control; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.trace_session_control TO ac_app;


--
-- Name: TABLE trace_source_admission; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.trace_source_admission TO ac_app;


--
-- Name: TABLE trace_tool_call_control; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.trace_tool_call_control TO ac_app;


--
-- Name: TABLE usage_admission; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.usage_admission TO ac_app;


--
-- Name: TABLE "user"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."user" TO ac_app;


--
-- Name: TABLE verification; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.verification TO ac_app;


--
-- Name: TABLE audit_retention; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.audit_retention TO ac_trace_control;


--
-- Name: TABLE installation_scope; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.installation_scope TO ac_trace_control;


--
-- Name: TABLE installations; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.installations TO ac_trace_control;


--
-- Name: TABLE metrics_health; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.metrics_health TO ac_trace_control;


--
-- Name: TABLE metrics_members; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.metrics_members TO ac_trace_control;


--
-- Name: TABLE organization_settings; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.organization_settings TO ac_trace_control;


--
-- Name: TABLE session_scope; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.session_scope TO ac_trace_control;


--
-- Name: TABLE sessions; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.sessions TO ac_trace_control;


--
-- Name: TABLE user_scope; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.user_scope TO ac_trace_control;


--
-- Name: TABLE users; Type: ACL; Schema: trace_control; Owner: -
--

GRANT SELECT ON TABLE trace_control.users TO ac_trace_control;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



INSERT INTO public.trace_analytics_retention(id,retained_after) VALUES (1,'1970-01-01T00:00:00Z');

-- Canonical parent matching is a compact control-plane identity operation.
CREATE FUNCTION public.native_identity(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER PARALLEL SAFE
RETURN CASE WHEN value ~ '^redacted-[a-f0-9]{64}$' THEN value
 ELSE 'redacted-' || encode(sha256(convert_to(value,'UTF8')),'hex') END;
REVOKE ALL ON FUNCTION public.native_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.native_identity(text) TO ac_app;
CREATE INDEX trace_pending_parent_identity ON public.trace_session_control
 (organization_id,harness,public.native_identity(parent_native_ref)) WHERE parent_session_id IS NULL;

-- Native SKIP LOCKED requires UPDATE permission on a selected column, even though
-- projection only deletes acknowledged rows. The trigger prohibits actual rewrites.
GRANT UPDATE(audit_id) ON public.trace_audit_outbox TO ac_app;
CREATE FUNCTION public.prevent_trace_audit_outbox_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit projection outbox rows are immutable' USING ERRCODE='55000';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_trace_audit_outbox_rewrite() FROM PUBLIC;
CREATE TRIGGER immutable_payload BEFORE UPDATE ON public.trace_audit_outbox
FOR EACH ROW EXECUTE FUNCTION public.prevent_trace_audit_outbox_rewrite();
