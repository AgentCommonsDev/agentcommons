// Generated from the server OpenAPI contract. Do not edit.
import type { JsonValue } from "@agentcommons/core/schemas/common";
export interface paths {
  "/api/v1/dashboards": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List organization dashboards, the definition schema and tile templates */
    get: operations["get_dashboards"];
    put?: never;
    /** Create or update a dashboard */
    post: operations["post_dashboards"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/dashboards/render": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Run the queries of a dashboard with variable values */
    post: operations["post_dashboards_render"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/dashboards/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read a dashboard and its definition */
    get: operations["get_dashboards_id"];
    put?: never;
    post?: never;
    /** Delete a dashboard */
    delete: operations["delete_dashboards_id"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/dashboards/{id}/default": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Make a dashboard the organization default for Home */
    post: operations["post_dashboards_id_default"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/organization/embeddings": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read organization embedding configuration and progress */
    get: operations["get_organization_embeddings"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Enable or disable embeddings for this organization */
    patch: operations["patch_organization_embeddings"];
    trace?: never;
  };
  "/api/v1/organization/sso": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read whether this organization requires SSO sign-in */
    get: operations["get_organization_sso"];
    /** Require or stop requiring SSO sign-in for this organization */
    put: operations["put_organization_sso"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/billing": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the organization's monthly session usage */
    get: operations["get_billing"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/billing/checkout": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Open Pro checkout for the current organization */
    post: operations["post_billing_checkout"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/billing/portal": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Open the current organization's billing portal */
    post: operations["post_billing_portal"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/ingest": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Upload session records */
    post: operations["post_ingest"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/search": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Search previous session messages */
    post: operations["post_search"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/query": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Query the caller-visible SQL schema */
    post: operations["post_query"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/schema": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Describe the caller-visible SQL schema */
    get: operations["get_schema"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/sessions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List sessions */
    get: operations["get_sessions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/sessions/{id}/similar": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Find similar visible sessions */
    get: operations["get_sessions_id_similar"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/sessions/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read a session */
    get: operations["get_sessions_id"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/sessions/{id}/raw": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read redacted source records */
    get: operations["get_sessions_id_raw"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/sessions/{id}/tree": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the visible session tree */
    get: operations["get_sessions_id_tree"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/sessions/{id}/events": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Watch session status changes */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "text/event-stream": string;
          };
        };
        /** @description Default Response */
        "4XX": {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              code: string;
              message: string;
              position?: number | null;
              detail?: components["schemas"]["JsonValue"];
            };
          };
        };
        /** @description Default Response */
        "5XX": {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              code: string;
              message: string;
              position?: number | null;
              detail?: components["schemas"]["JsonValue"];
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/repos": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List repositories */
    get: operations["get_repos"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/installations": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List installations */
    get: operations["get_installations"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/sessions/{id}/reuse": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List sessions that reused or were reused by this session */
    get: operations["get_sessions_id_reuse"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/me/organizations": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List current organization memberships */
    get: operations["get_me_organizations"];
    put?: never;
    /** Create another organization with a verified SaaS identity */
    post: operations["post_me_organizations"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/onboarding": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Create the verified identity's first organization */
    post: operations["post_onboarding"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/me": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the current identity and organization */
    get: operations["get_me"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/me/organization": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Select an active organization */
    post: operations["post_me_organization"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/me/keys": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List your organization API keys */
    get: operations["get_me_keys"];
    put?: never;
    /** Create your organization API key */
    post: operations["post_me_keys"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/me/keys/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Revoke your organization API key */
    delete: operations["delete_me_keys_id"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/me/keys/{id}/reveal": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Reveal one of your API keys */
    post: operations["post_me_keys_id_reveal"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/tool-policy": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the caller organization's active tool and command policy for offline enforcement */
    get: operations["get_tool_policy"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/tool-policy/violations": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Report tool-policy decisions the pre-tool gate made */
    post: operations["post_tool_policy_violations"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/domains": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List Google SSO domain access */
    get: operations["get_admin_domains"];
    put?: never;
    /** Allow a Google email domain to join this organization */
    post: operations["post_admin_domains"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/users": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List organization members */
    get: operations["get_admin_users"];
    put?: never;
    /** Add people to the organization */
    post: operations["post_admin_users"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/users/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read one organization member */
    get: operations["get_admin_users_id"];
    put?: never;
    post?: never;
    /** Remove an organization member */
    delete: operations["delete_admin_users_id"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/users/password-setup": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Issue initial password setup */
    post: operations["post_admin_users_password_setup"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/users/{id}/role": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Change an organization member role */
    patch: operations["patch_admin_users_id_role"];
    trace?: never;
  };
  "/api/v1/admin/users/{id}/suspension": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Suspend or restore a membership */
    patch: operations["patch_admin_users_id_suspension"];
    trace?: never;
  };
  "/api/v1/admin/keys": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List organization API keys */
    get: operations["get_admin_keys"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/keys/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Revoke an organization API key */
    delete: operations["delete_admin_keys_id"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/sessions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List every session of the organization for moderation */
    get: operations["get_admin_sessions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/sessions/{id}/visibility": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Change session visibility */
    post: operations["post_admin_sessions_id_visibility"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/installations": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List installations with hook bundle heal status against the served manifest */
    get: operations["get_admin_installations"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/installations/{id}/tools": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Enable or disable installation MCP tools */
    post: operations["post_admin_installations_id_tools"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/sessions/{id}/purge": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Purge session contents */
    post: operations["post_admin_sessions_id_purge"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/audit": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List organization audit events */
    get: operations["get_admin_audit"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/metrics/{group}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read filtered organization metrics */
    get: operations["get_admin_metrics_group"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/status": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read organization ingestion status */
    get: operations["get_admin_status"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/redaction/policies": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List redaction policies */
    get: operations["get_admin_redaction_policies"];
    put?: never;
    /** Create a redaction policy */
    post: operations["post_admin_redaction_policies"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/redaction/policies/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Remove a redaction policy */
    delete: operations["delete_admin_redaction_policies_id"];
    options?: never;
    head?: never;
    /** Update a redaction policy */
    patch: operations["patch_admin_redaction_policies_id"];
    trace?: never;
  };
  "/api/v1/admin/redaction/test": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Test organization redaction policies */
    post: operations["post_admin_redaction_test"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/redaction/summary": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the organization's redaction totals, recent windows, per-policy counts and run tally */
    get: operations["get_admin_redaction_summary"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/redaction/hits": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List where redactions landed: session, message position, policy, source and time */
    get: operations["get_admin_redaction_hits"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/redaction/rescan": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List redaction rescan runs with progress and the sessions each changed */
    get: operations["get_admin_redaction_rescan"];
    put?: never;
    /** Rescan existing organization records */
    post: operations["post_admin_redaction_rescan"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/redaction/rescan/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read redaction rescan progress */
    get: operations["get_admin_redaction_rescan_id"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/redaction/rescan/{id}/sessions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List the sessions a redaction rescan run changed, with counts */
    get: operations["get_admin_redaction_rescan_id_sessions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/tool-policy": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the organization's tool and command policy */
    get: operations["get_admin_tool_policy"];
    /** Replace the organization's tool and command policy */
    put: operations["put_admin_tool_policy"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/tool-policy/violations": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List recorded tool-policy violations: session, rule, decision, severity and time */
    get: operations["get_admin_tool_policy_violations"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/health": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Check process health */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {string} */
              status: "ok" | "unavailable";
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/health": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Check process health */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {string} */
              status: "ok" | "unavailable";
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/ready": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Check database readiness */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {string} */
              status: "ok" | "unavailable";
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {string} */
              status: "ok" | "unavailable";
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/ready": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Check database readiness */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {string} */
              status: "ok" | "unavailable";
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {string} */
              status: "ok" | "unavailable";
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/billing/config": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read public plans and billing availability */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {string} */
              mode: "customer" | "public" | "saas";
              enabled: boolean;
              plans: {
                free: {
                  monthly_records: number;
                };
                pro: {
                  included_records: number;
                  /**
                   * @default 100
                   * @enum {number}
                   */
                  monthly_price_usd: 100;
                  capture_usd_per_1000: number | null;
                };
                embeddings: {
                  /**
                   * @default 50
                   * @enum {number}
                   */
                  monthly_price_usd: 50;
                  messages_usd_per_1000: number | null;
                };
              };
              checkout_enabled: boolean;
              cal_com_url: string | null;
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/auth/config": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read enabled login methods */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @default [] */
              features: "similar_sessions"[];
              email_password_enabled: boolean;
              social_provider: string | null;
              oidc_enabled: boolean;
              /** @enum {string} */
              signup_mode: "open" | "invite" | "closed";
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    JsonValueInput: JsonValue;
    DashboardChartInput: {
      series: {
        /** @enum {string} */
        type: "line" | "bar" | "pie" | "scatter" | "gauge" | "heatmap";
        name?: string;
        encode?: {
          x?: string;
          y?: string | string[];
          value?: string;
          itemName?: string;
          tooltip?: string[];
        };
        stack?: string;
        smooth?: boolean;
        step?: boolean | ("start" | "middle" | "end");
        showSymbol?: boolean;
        symbol?: string;
        symbolSize?: number;
        connectNulls?: boolean;
        areaStyle?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        lineStyle?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        itemStyle?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        label?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        labelLine?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        emphasis?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        barWidth?: number | string;
        barMaxWidth?: number | string;
        barGap?: string;
        radius?: (number | string) | (number | string)[];
        center?: (number | string)[];
        roseType?: boolean | ("radius" | "area");
        xAxisIndex?: number;
        yAxisIndex?: number;
        min?: number;
        max?: number;
        progress?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        detail?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        axisLine?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        pointer?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        splitLine?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        axisLabel?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        axisTick?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        title?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
      }[];
      xAxis?:
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }[];
      yAxis?:
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }[];
      legend?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      tooltip?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      grid?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      color?: string[];
      dataZoom?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      }[];
      visualMap?:
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }[];
      polar?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      radiusAxis?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      angleAxis?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
    };
    DashboardTileInput:
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "stat";
          sql: string;
          value?: string;
          compare?: string;
          /**
           * @default count
           * @enum {string}
           */
          unit:
            "count" | "ratio" | "seconds" | "milliseconds" | "tokens" | "usd";
        }
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "chart";
          sql: string;
          series_by?: string;
          /** @enum {string} */
          unit?:
            "count" | "ratio" | "seconds" | "milliseconds" | "tokens" | "usd";
          chart: components["schemas"]["DashboardChartInput"];
        }
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "table";
          sql: string;
          columns?: string[];
        }
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "text";
          markdown: string;
        }
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "control";
          variable: string;
        };
    DashboardVariableInput:
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "time_range";
          /**
           * @default 30d
           * @enum {string}
           */
          default:
            | "24h"
            | "7d"
            | "14d"
            | "30d"
            | "90d"
            | "this_week"
            | "last_week"
            | "this_month"
            | "all";
        }
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "repo";
        }
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "harness";
        }
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "user";
        }
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "text";
          /** @default  */
          default: string;
        };
    DashboardDefinitionInput: {
      /** @constant */
      version: 2;
      /** @default [] */
      variables: components["schemas"]["DashboardVariableInput"][];
      tiles: components["schemas"]["DashboardTileInput"][];
    };
    JsonValue: JsonValue;
    DashboardChart: {
      series: {
        /** @enum {string} */
        type: "line" | "bar" | "pie" | "scatter" | "gauge" | "heatmap";
        name?: string;
        encode?: {
          x?: string;
          y?: string | string[];
          value?: string;
          itemName?: string;
          tooltip?: string[];
        };
        stack?: string;
        smooth?: boolean;
        step?: boolean | ("start" | "middle" | "end");
        showSymbol?: boolean;
        symbol?: string;
        symbolSize?: number;
        connectNulls?: boolean;
        areaStyle?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        lineStyle?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        itemStyle?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        label?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        labelLine?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        emphasis?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        barWidth?: number | string;
        barMaxWidth?: number | string;
        barGap?: string;
        radius?: (number | string) | (number | string)[];
        center?: (number | string)[];
        roseType?: boolean | ("radius" | "area");
        xAxisIndex?: number;
        yAxisIndex?: number;
        min?: number;
        max?: number;
        progress?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        detail?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        axisLine?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        pointer?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        splitLine?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        axisLabel?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        axisTick?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
        title?: {
          [key: string]:
            | (
                | (string | number | boolean | null)
                | (string | number | boolean | null)[]
              )
            | {
                [key: string]:
                  | (
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[]
                    )
                  | {
                      [key: string]:
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[];
                    };
              };
        };
      }[];
      xAxis?:
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }[];
      yAxis?:
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }[];
      legend?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      tooltip?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      grid?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      color?: string[];
      dataZoom?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      }[];
      visualMap?:
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }
        | {
            [key: string]:
              | (
                  | (string | number | boolean | null)
                  | (string | number | boolean | null)[]
                )
              | {
                  [key: string]:
                    | (
                        | (string | number | boolean | null)
                        | (string | number | boolean | null)[]
                      )
                    | {
                        [key: string]:
                          | (string | number | boolean | null)
                          | (string | number | boolean | null)[];
                      };
                };
          }[];
      polar?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      radiusAxis?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
      angleAxis?: {
        [key: string]:
          | (
              | (string | number | boolean | null)
              | (string | number | boolean | null)[]
            )
          | {
              [key: string]:
                | (
                    | (string | number | boolean | null)
                    | (string | number | boolean | null)[]
                  )
                | {
                    [key: string]:
                      | (string | number | boolean | null)
                      | (string | number | boolean | null)[];
                  };
            };
      };
    };
    DashboardTile:
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "stat";
          sql: string;
          value?: string;
          compare?: string;
          /**
           * @default count
           * @enum {string}
           */
          unit:
            "count" | "ratio" | "seconds" | "milliseconds" | "tokens" | "usd";
        }
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "chart";
          sql: string;
          series_by?: string;
          /** @enum {string} */
          unit?:
            "count" | "ratio" | "seconds" | "milliseconds" | "tokens" | "usd";
          chart: components["schemas"]["DashboardChart"];
        }
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "table";
          sql: string;
          columns?: string[];
        }
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "text";
          markdown: string;
        }
      | {
          id: string;
          title: string;
          description?: string;
          layout: {
            x: number;
            y: number;
            w: number;
            h: number;
          };
          /** @constant */
          type: "control";
          variable: string;
        };
    DashboardVariable:
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "time_range";
          /**
           * @default 30d
           * @enum {string}
           */
          default:
            | "24h"
            | "7d"
            | "14d"
            | "30d"
            | "90d"
            | "this_week"
            | "last_week"
            | "this_month"
            | "all";
        }
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "repo";
        }
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "harness";
        }
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "user";
        }
      | {
          name: string;
          label?: string;
          /** @constant */
          type: "text";
          /** @default  */
          default: string;
        };
    DashboardDefinition: {
      /** @constant */
      version: 2;
      /** @default [] */
      variables: components["schemas"]["DashboardVariable"][];
      tiles: components["schemas"]["DashboardTile"][];
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  get_dashboards: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** Format: uuid */
              id: string;
              organization_id: string;
              name: string;
              description: string;
              revision: number;
              builtin: boolean;
              is_default: boolean;
              can_edit: boolean;
              created_by: {
                user_id: string;
                email: string | null;
                name: string | null;
              } | null;
              tile_count: number;
              /** Format: date-time */
              created_at: string;
              /** Format: date-time */
              updated_at: string;
            }[];
            /** Format: uuid */
            default_id: string;
            definition_schema: components["schemas"]["JsonValue"];
            templates: {
              id: string;
              title: string;
              description: string;
              /** @default [] */
              variables: components["schemas"]["DashboardVariable"][];
              tile: components["schemas"]["DashboardTile"];
            }[];
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_dashboards: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** Format: uuid */
          id?: string;
          revision?: number;
          name: string;
          /** @default  */
          description?: string;
          definition: components["schemas"]["DashboardDefinitionInput"];
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            id: string;
            organization_id: string;
            name: string;
            description: string;
            revision: number;
            builtin: boolean;
            is_default: boolean;
            can_edit: boolean;
            created_by: {
              user_id: string;
              email: string | null;
              name: string | null;
            } | null;
            tile_count: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            definition: components["schemas"]["DashboardDefinition"];
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_dashboards_render: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** Format: uuid */
          id?: string;
          definition?: components["schemas"]["DashboardDefinitionInput"];
          /** @default {} */
          variables?: {
            [key: string]:
              | (
                  | (
                      | "24h"
                      | "7d"
                      | "14d"
                      | "30d"
                      | "90d"
                      | "this_week"
                      | "last_week"
                      | "this_month"
                      | "all"
                    )
                  | {
                      /** Format: date-time */
                      from: string;
                      /** Format: date-time */
                      to: string;
                    }
                )
              | string[]
              | string;
          };
          tiles?: string[];
          /** @default false */
          refresh?: boolean;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            tiles: {
              id: string;
              result: {
                columns: {
                  name: string;
                  type: string;
                }[];
                rows: components["schemas"]["JsonValue"][][];
                row_count: number;
                capped: boolean;
                truncated_cells: [number, number][];
                duration_ms: number;
              } | null;
              error: {
                code: string;
                message: string;
              } | null;
            }[];
            variables: {
              [key: string]:
                | {
                    /** Format: date-time */
                    from: string;
                    /** Format: date-time */
                    to: string;
                  }
                | string[]
                | string;
            };
            /** Format: date-time */
            rendered_at: string;
            cached: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_dashboards_id: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            id: string;
            organization_id: string;
            name: string;
            description: string;
            revision: number;
            builtin: boolean;
            is_default: boolean;
            can_edit: boolean;
            created_by: {
              user_id: string;
              email: string | null;
              name: string | null;
            } | null;
            tile_count: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            definition: components["schemas"]["DashboardDefinition"];
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  delete_dashboards_id: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": Record<string, never> | null;
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            deleted: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_dashboards_id_default: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": Record<string, never>;
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            default_id: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_organization_embeddings: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            enabled: boolean;
            available: boolean;
            entitled: boolean;
            effective: boolean;
            provider: ("openai" | "fake") | null;
            model: string | null;
            sessions_total: number;
            sessions_indexed: number;
            sessions_pending: number;
            last_attempt: ("completed" | "failed" | "reserved") | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  patch_organization_embeddings: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          reason: string;
          enabled: boolean;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            enabled: boolean;
            available: boolean;
            entitled: boolean;
            effective: boolean;
            provider: ("openai" | "fake") | null;
            model: string | null;
            sessions_total: number;
            sessions_indexed: number;
            sessions_pending: number;
            last_attempt: ("completed" | "failed" | "reserved") | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_organization_sso: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            sso_only: boolean;
            revision: number;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  put_organization_sso: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          sso_only: boolean;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            sso_only: boolean;
            revision: number;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_billing: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            plan: "free" | "pro" | "pro_embeddings" | "unmetered";
            /** Format: date-time */
            period_start: string;
            /** Format: date-time */
            period_end: string;
            records_used: number;
            included_records: number | null;
            remaining: number | null;
            overage_records: number;
            embedding_messages_used: number;
            estimated_capture_usd: number | null;
            estimated_embedding_usd: number | null;
            metering_pending: number;
            metering_reconciliation_required: number;
            can_manage: boolean;
            checkout_enabled: boolean;
            portal_enabled: boolean;
            cal_com_url: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_billing_checkout: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @enum {string} */
          plan: "pro" | "pro_embeddings";
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            url: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_billing_portal: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": Record<string, never>;
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            url: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_ingest: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @enum {number} */
          envelopeVersion: 2;
          /** @enum {string} */
          harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
          harnessSessionId: string;
          /** @enum {string} */
          behavior: "start" | "sync" | "end";
          nativeEvent: string;
          /** @default null */
          start?: {
            resume: boolean;
          } | null;
          /** Format: uuid */
          batchId: string;
          /** Format: uuid */
          installationId: string;
          hook: {
            sha256: string;
            extensionSha256: string | null;
          };
          /** Format: date-time */
          sentAt: string;
          sourcePos: number;
          context: {
            cwd: string;
            installation: {
              hostname: string;
              osUser: string;
              platform: string;
              arch: string;
            };
            activeLeafId?: string | null;
            transcriptMetadata?: {
              [key: string]: components["schemas"]["JsonValueInput"];
            };
            git: {
              root: string;
              remoteUrl: string | null;
              branch: string | null;
              head: string | null;
            } | null;
            parentHint: {
              harnessSessionId: string;
              /** @enum {string} */
              relation: "SUBAGENT" | "SPAWNED";
              agentId?: string;
              agentType?: string;
            } | null;
          };
          records: {
            pos: number;
            key?: string | null;
            /** @default 0 */
            sourceVersion?: number;
            line: string;
          }[];
          cursor: string;
          end: {
            reason: string | null;
            head: string | null;
            observedCommits: {
              sha: string;
              subject: string;
              author: string;
              timestamp: string | null;
            }[];
            observedDiffStat: {
              [key: string]: components["schemas"]["JsonValueInput"];
            } | null;
            dirtyFileCount: number | null;
          } | null;
        };
      };
    };
    responses: {
      /** @description Default Response */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @enum {string} */
            publication: "queued" | "published";
            /** Format: uuid */
            sessionId: string;
            accepted: number;
            duplicates: number;
            cursor: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_search: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description Words to find; every word must appear (English stems match). May be empty when a filter is given */
          query: string;
          /**
           * @description Narrow by session or message fields. Each key takes one value or a list (any of); every key given must hold
           * @default {}
           */
          filters?: {
            /** @description Sessions in these repositories: host/org/repo, or org/repo or the bare repository name when only one repository matches */
            repo_name?: string | string[];
            /** @description Sessions on these git branches (exact) */
            branch?: string | string[];
            /** @description Sessions run by these members (exact email) */
            user_email?: string | string[];
            /** @description Sessions uploaded with these ingest API keys (key id, exact); the Install page uses it to show one machine's sessions */
            ingest_api_key_id?: string | string[];
            /** @description Messages calling or answering these tools, such as Read or Bash */
            tool_name?: string | string[];
            /** @description Sessions that touched a file whose path starts with this text, such as src/auth/ */
            file_prefix?: string | string[];
            /** @description Sessions where a file was read, edited, written or deleted; with file_prefix, the same file must match both */
            file_operation?:
              | ("read" | "edit" | "write" | "delete")
              | ("read" | "edit" | "write" | "delete")[];
            /** @description Messages with these roles */
            role?:
              | ("USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM")
              | ("USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM")[];
            /** @description Search inside these sessions only */
            session_id?: string | string[];
            /** @description Messages at or after this UTC time (inclusive) */
            since?: string | string[];
            /** @description Messages before this UTC time (exclusive) */
            until?: string | string[];
            /** @description Up to 10 extra conditions that must all hold, on a message field (tool_name, tool_use_id, content, role, kind, model, or a JSON path inside tool_input) or a session field (harness, title, repo_name, branch, user_email, status) */
            where?: (
              | {
                  /**
                   * @description Field to test. Message fields: tool_name, tool_use_id, content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch, user_email, status
                   * @enum {string}
                   */
                  field:
                    | "tool_name"
                    | "tool_use_id"
                    | "content"
                    | "role"
                    | "kind"
                    | "model"
                    | "harness"
                    | "title"
                    | "repo_name"
                    | "branch"
                    | "user_email"
                    | "status"
                    | "tool_input";
                  /** @description JSON keys or array positions inside tool_input, such as ["file_path"]; only with field tool_input */
                  path?: string[];
                  /** @enum {string} */
                  op: "eq";
                  value: string | number | boolean | null;
                }
              | {
                  /**
                   * @description Field to test. Message fields: tool_name, tool_use_id, content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch, user_email, status
                   * @enum {string}
                   */
                  field:
                    | "tool_name"
                    | "tool_use_id"
                    | "content"
                    | "role"
                    | "kind"
                    | "model"
                    | "harness"
                    | "title"
                    | "repo_name"
                    | "branch"
                    | "user_email"
                    | "status"
                    | "tool_input";
                  /** @description JSON keys or array positions inside tool_input, such as ["file_path"]; only with field tool_input */
                  path?: string[];
                  /** @enum {string} */
                  op: "contains";
                  value: string;
                }
              | {
                  /**
                   * @description Field to test. Message fields: tool_name, tool_use_id, content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch, user_email, status
                   * @enum {string}
                   */
                  field:
                    | "tool_name"
                    | "tool_use_id"
                    | "content"
                    | "role"
                    | "kind"
                    | "model"
                    | "harness"
                    | "title"
                    | "repo_name"
                    | "branch"
                    | "user_email"
                    | "status"
                    | "tool_input";
                  /** @description JSON keys or array positions inside tool_input, such as ["file_path"]; only with field tool_input */
                  path?: string[];
                  /** @enum {string} */
                  op: "starts_with";
                  value: string;
                }
              | {
                  /**
                   * @description Field to test. Message fields: tool_name, tool_use_id, content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch, user_email, status
                   * @enum {string}
                   */
                  field:
                    | "tool_name"
                    | "tool_use_id"
                    | "content"
                    | "role"
                    | "kind"
                    | "model"
                    | "harness"
                    | "title"
                    | "repo_name"
                    | "branch"
                    | "user_email"
                    | "status"
                    | "tool_input";
                  /** @description JSON keys or array positions inside tool_input, such as ["file_path"]; only with field tool_input */
                  path?: string[];
                  /** @enum {string} */
                  op: "exists";
                }
            )[];
          };
          /**
           * @description Neighbouring non-thinking messages either side of each hit
           * @default 1
           */
          context?: number;
          /**
           * @description Hit messages per page; at most 3 hits per session
           * @default 5
           */
          limit?: number;
          /**
           * @description Cursor from the previous page; null for the first page
           * @default null
           */
          cursor?: string | null;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @description Message windows grouped by session, best match first */
            blocks: {
              /**
               * Format: uuid
               * @description Session the messages belong to; pass to get for the full transcript
               */
              session_id: string;
              /**
               * Format: uuid
               * @description Root of the session tree. Equals session_id unless the hit sits inside a subagent, fork or spawned run; open the root and read the run inline.
               */
              root_session_id: string;
              /** @description How this session relates to its parent; null for a root session. */
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              /** @description Harness agent type of a subagent run, when the harness reports one. */
              agent_type: string | null;
              /** @description The parent's tool call that spawned this run, when recorded and the parent is visible; null for a root session. */
              parent_tool_use_id: string | null;
              /** @description Short title derived from the session */
              title: string | null;
              /**
               * @description Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
               * @enum {string}
               */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              /** @description Primary model used */
              model: string | null;
              /** @description Repository name such as owner/repo; joins repos.repo_name */
              repo_name: string | null;
              /** @description Git branch last observed in the session */
              branch: string | null;
              /**
               * Format: email
               * @description Email of the member who ran it
               */
              user_email: string;
              /**
               * @description true when this session's author is another member of your organization
               * @default false
               */
              by_teammate: boolean;
              /**
               * Format: date-time
               * @description When the session started (UTC)
               */
              started_at: string;
              /** @description Matched messages and their context, in seq order */
              messages: {
                /** @description Position of the block within the session, ascending */
                seq: number;
                /**
                 * @description USER, ASSISTANT, TOOL_RESULT or SYSTEM
                 * @enum {string}
                 */
                role: "USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM";
                /**
                 * @description TEXT, THINKING, TOOL_USE, TOOL_RESULT or META
                 * @enum {string}
                 */
                kind: "TEXT" | "THINKING" | "TOOL_USE" | "TOOL_RESULT" | "META";
                /** @description Tool called or answered, for TOOL_USE and TOOL_RESULT */
                tool_name?: string | null;
                /** @description Harness id pairing a tool call with its result */
                tool_use_id?: string | null;
                /** @description Excerpt of the message text, centred on the match */
                content: string;
                /** @description True for a matched message, false for surrounding context */
                hit: boolean;
                /** @description True when content is an excerpt of a longer message */
                truncated: boolean;
                /** @description Where the excerpt sits in the full content when truncated; null when content is complete. Read the rest with get(session_id, cursor: {seq, offset: start}) */
                content_range: {
                  /** @description First UTF-8 byte of the excerpt inside the full content */
                  start: number;
                  /** @description Byte after the excerpt's last byte */
                  end: number;
                  /** @description UTF-8 bytes of the full content */
                  total: number;
                } | null;
                /**
                 * @description Fields shortened to fit the response
                 * @default []
                 */
                truncated_fields: string[];
              }[];
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
            }[];
            /**
             * @description Cursor for the next page; null when there is none
             * @default null
             */
            cursor: string | null;
            /** @description True when the page was cut to fit the response size limit; continue with cursor */
            truncated_response: boolean;
            /** @description Totals over every hit the query and filters match under the caller's visibility, not only this page */
            total: {
              /** @description Distinct sessions with at least one matching message, across every page */
              sessions: number;
              /** @description Matching messages before the per-session cap and paging */
              hits: number;
            };
            /** @description Set when the full search exceeded the read time limit and this page searched only the most recently active matching sessions; null for a complete search. Narrow the filters to search the rest. */
            partial: {
              /** @description How many of the most recently active matching sessions this bounded page searched */
              sessions_searched: number;
            } | null;
            /** @description What to try when this page has no hit: the shorter query, the filter to drop or the sql that lists the indexed repositories; null when the page has hits */
            next: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_query: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          sql: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            columns: {
              name: string;
              type: string;
            }[];
            rows: components["schemas"]["JsonValue"][][];
            row_count: number;
            capped: boolean;
            truncated_cells: [number, number][];
            duration_ms: number;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_schema: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            columns: {
              view_name: string;
              column_name: string;
              data_type: string;
              ordinal_position: number;
              description: string | null;
            }[];
            functions: {
              function_name: string;
              arguments: string;
              result_type: string;
              description: string | null;
            }[];
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_sessions: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "title"
          | "harness"
          | "harness_version"
          | "model"
          | "repo_name"
          | "branch"
          | "user_email"
          | "installation_hostname"
          | "started_at"
          | "duration_seconds"
          | "message_count"
          | "tool_call_count"
          | "observed_commit_count"
          | "reuse_count"
          | "agentcommons_search_calls"
          | "reuses_made"
          | "status"
          | "last_activity_at";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        /** @description Narrow by session or message fields. Each key takes one value or a list (any of); every key given must hold */
        filters?: {
          /** @description Sessions in these repositories: host/org/repo, or org/repo or the bare repository name when only one repository matches */
          repo_name?: string | string[];
          /** @description Sessions on these git branches (exact) */
          branch?: string | string[];
          /** @description Sessions run by these members (exact email) */
          user_email?: string | string[];
          /** @description Sessions uploaded with these ingest API keys (key id, exact); the Install page uses it to show one machine's sessions */
          ingest_api_key_id?: string | string[];
          /** @description Messages calling or answering these tools, such as Read or Bash */
          tool_name?: string | string[];
          /** @description Sessions that touched a file whose path starts with this text, such as src/auth/ */
          file_prefix?: string | string[];
          /** @description Sessions where a file was read, edited, written or deleted; with file_prefix, the same file must match both */
          file_operation?:
            | ("read" | "edit" | "write" | "delete")
            | ("read" | "edit" | "write" | "delete")[];
          /** @description Messages with these roles */
          role?:
            | ("USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM")
            | ("USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM")[];
          /** @description Search inside these sessions only */
          session_id?: string | string[];
          /** @description Messages at or after this UTC time (inclusive) */
          since?: string | string[];
          /** @description Messages before this UTC time (exclusive) */
          until?: string | string[];
          /** @description Up to 10 extra conditions that must all hold, on a message field (tool_name, tool_use_id, content, role, kind, model, or a JSON path inside tool_input) or a session field (harness, title, repo_name, branch, user_email, status) */
          where?: (
            | {
                /**
                 * @description Field to test. Message fields: tool_name, tool_use_id, content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch, user_email, status
                 * @enum {string}
                 */
                field:
                  | "tool_name"
                  | "tool_use_id"
                  | "content"
                  | "role"
                  | "kind"
                  | "model"
                  | "harness"
                  | "title"
                  | "repo_name"
                  | "branch"
                  | "user_email"
                  | "status"
                  | "tool_input";
                /** @description JSON keys or array positions inside tool_input, such as ["file_path"]; only with field tool_input */
                path?: string[];
                /** @enum {string} */
                op: "eq";
                value: string | number | boolean | null;
              }
            | {
                /**
                 * @description Field to test. Message fields: tool_name, tool_use_id, content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch, user_email, status
                 * @enum {string}
                 */
                field:
                  | "tool_name"
                  | "tool_use_id"
                  | "content"
                  | "role"
                  | "kind"
                  | "model"
                  | "harness"
                  | "title"
                  | "repo_name"
                  | "branch"
                  | "user_email"
                  | "status"
                  | "tool_input";
                /** @description JSON keys or array positions inside tool_input, such as ["file_path"]; only with field tool_input */
                path?: string[];
                /** @enum {string} */
                op: "contains";
                value: string;
              }
            | {
                /**
                 * @description Field to test. Message fields: tool_name, tool_use_id, content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch, user_email, status
                 * @enum {string}
                 */
                field:
                  | "tool_name"
                  | "tool_use_id"
                  | "content"
                  | "role"
                  | "kind"
                  | "model"
                  | "harness"
                  | "title"
                  | "repo_name"
                  | "branch"
                  | "user_email"
                  | "status"
                  | "tool_input";
                /** @description JSON keys or array positions inside tool_input, such as ["file_path"]; only with field tool_input */
                path?: string[];
                /** @enum {string} */
                op: "starts_with";
                value: string;
              }
            | {
                /**
                 * @description Field to test. Message fields: tool_name, tool_use_id, content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch, user_email, status
                 * @enum {string}
                 */
                field:
                  | "tool_name"
                  | "tool_use_id"
                  | "content"
                  | "role"
                  | "kind"
                  | "model"
                  | "harness"
                  | "title"
                  | "repo_name"
                  | "branch"
                  | "user_email"
                  | "status"
                  | "tool_input";
                /** @description JSON keys or array positions inside tool_input, such as ["file_path"]; only with field tool_input */
                path?: string[];
                /** @enum {string} */
                op: "exists";
              }
          )[];
        };
        roots_only?: boolean;
        /** @description true: only sessions whose agent made a search or sql call while active; false: only sessions that made none */
        searched?: boolean;
        /** @description true: only sessions whose agent read an earlier session through get while active; false: only sessions that read none */
        used_prior_work?: boolean;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /**
               * Format: uuid
               * @description Primary key; every other view joins on it
               */
              session_id: string;
              /** @description Owning organization (already scoped) */
              organization_id: string;
              /** @description Short title derived from the session */
              title: string | null;
              /**
               * @description Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
               * @enum {string}
               */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              /** @description Harness version, if reported */
              harness_version: string | null;
              /** @description How the harness was launched, if reported */
              entrypoint: string | null;
              /** @description Primary model used */
              model: string | null;
              /** @description Every model seen in the session */
              models_used: string[];
              /**
               * Format: email
               * @description Email of the member who ran it
               */
              user_email: string;
              /**
               * @description true when this session's author is another member of your organization
               * @default false
               */
              by_teammate: boolean;
              /** @description Hostname of the capturing machine */
              installation_hostname: string;
              /**
               * Format: uuid
               * @description Machine install that captured it; joins installations.installation_id
               */
              installation_id: string;
              /** @description Repository name such as owner/repo; joins repos.repo_name */
              repo_name: string | null;
              /** @description Remote URL of the repository */
              repo_url: string | null;
              /** @description Git branch last observed in the session */
              branch: string | null;
              /** @description Every distinct branch the session worked on, including switches; see session_observed_branches */
              observed_branches: string[];
              /** @description cwd relative to repo_root */
              cwd_relative: string | null;
              /** @description HEAD SHA at session start */
              start_commit: string | null;
              /** @description HEAD SHA at session end */
              end_commit: string | null;
              /**
               * Format: date-time
               * @description When the session started (UTC)
               */
              started_at: string;
              /** @description When the session ended; NULL while active */
              ended_at: string | null;
              /**
               * @description ACTIVE, ENDED or INACTIVE
               * @enum {string}
               */
              status: "ACTIVE" | "ENDED" | "INACTIVE";
              /**
               * @description PUBLIC or PRIVATE
               * @enum {string}
               */
              visibility: "PUBLIC" | "PRIVATE";
              /** @description When content was purged; NULL otherwise */
              purged_at: string | null;
              /** @description Why the session ended, as the harness reported it */
              end_reason: string | null;
              /** @description Rows in messages for this session */
              message_count: number;
              /** @description Tool calls made */
              tool_call_count: number;
              /** @description Input tokens consumed */
              input_tokens: string | null;
              /** @description Output tokens produced */
              output_tokens: string | null;
              /** @description Distinct tool names called; see session_tools */
              tools_used: string[];
              /** @description Files read, edited, written or deleted; see session_files */
              file_count: number;
              /** @description Commits observed during the session */
              observed_commit_count: number;
              /** @description Distinct branches the session worked on */
              observed_branch_count: number;
              /** @description Later sessions that read this one; see session_reuse */
              reuse_count: number;
              /** @description search and sql calls credited to the session while active */
              agentcommons_search_calls: number;
              /** @description Distinct earlier sessions this one read through get; see reuse_edges */
              reuses_made: number;
              /** @description Subagent type when the session is a subagent */
              agent_type: string | null;
              /** @description Parent session of a subagent, fork or spawned session */
              parent_session_id: string | null;
              /** @description SUBAGENT, FORK or SPAWNED */
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
              parent_tool_use_id: string | null;
              /** @description Parent session when visible; null for a root session */
              parent: {
                /**
                 * Format: uuid
                 * @description Related session; pass to get
                 */
                session_id: string;
                /** @description Short title derived from the session */
                title: string | null;
                /** @description SUBAGENT, FORK or SPAWNED */
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
                parent_tool_use_id: string | null;
                /** @description Subagent type when the session is a subagent */
                agent_type: string | null;
              } | null;
              /** @description Up to 10 direct child sessions: subagents, forks and spawned runs */
              children: {
                /**
                 * Format: uuid
                 * @description Related session; pass to get
                 */
                session_id: string;
                /** @description Short title derived from the session */
                title: string | null;
                /** @description SUBAGENT, FORK or SPAWNED */
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
                parent_tool_use_id: string | null;
                /** @description Subagent type when the session is a subagent */
                agent_type: string | null;
              }[];
              /** @description Direct child sessions */
              child_count: number;
              /** @description True when more children exist than are listed */
              children_truncated: boolean;
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
              /**
               * Format: uuid
               * @description Top of this session's parent chain; equals session_id for a root session
               */
              root_session_id: string;
              duration_seconds: number | null;
              /** Format: date-time */
              last_activity_at: string;
            }[];
            /** @default null */
            cursor: string | null;
            /** @description Totals over every matching session, computed with the same filters and roots_only as the page */
            total: {
              /** @description Sessions the filters match under the caller's visibility, across every page */
              sessions: number;
              /** @description Sum of message_count over those sessions */
              messages: number;
            };
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_sessions_id_similar: {
    parameters: {
      query?: {
        max_rows?: number;
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            sessions: {
              /**
               * Format: uuid
               * @description Primary key; every other view joins on it
               */
              session_id: string;
              /** @description Owning organization (already scoped) */
              organization_id: string;
              /** @description Short title derived from the session */
              title: string | null;
              /**
               * @description Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
               * @enum {string}
               */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              /** @description Harness version, if reported */
              harness_version: string | null;
              /** @description How the harness was launched, if reported */
              entrypoint: string | null;
              /** @description Primary model used */
              model: string | null;
              /** @description Every model seen in the session */
              models_used: string[];
              /**
               * Format: email
               * @description Email of the member who ran it
               */
              user_email: string;
              /**
               * @description true when this session's author is another member of your organization
               * @default false
               */
              by_teammate: boolean;
              /** @description Hostname of the capturing machine */
              installation_hostname: string;
              /**
               * Format: uuid
               * @description Machine install that captured it; joins installations.installation_id
               */
              installation_id: string;
              /** @description Repository name such as owner/repo; joins repos.repo_name */
              repo_name: string | null;
              /** @description Remote URL of the repository */
              repo_url: string | null;
              /** @description Git branch last observed in the session */
              branch: string | null;
              /** @description Every distinct branch the session worked on, including switches; see session_observed_branches */
              observed_branches: string[];
              /** @description cwd relative to repo_root */
              cwd_relative: string | null;
              /** @description HEAD SHA at session start */
              start_commit: string | null;
              /** @description HEAD SHA at session end */
              end_commit: string | null;
              /**
               * Format: date-time
               * @description When the session started (UTC)
               */
              started_at: string;
              /** @description When the session ended; NULL while active */
              ended_at: string | null;
              /**
               * @description ACTIVE, ENDED or INACTIVE
               * @enum {string}
               */
              status: "ACTIVE" | "ENDED" | "INACTIVE";
              /**
               * @description PUBLIC or PRIVATE
               * @enum {string}
               */
              visibility: "PUBLIC" | "PRIVATE";
              /** @description When content was purged; NULL otherwise */
              purged_at: string | null;
              /** @description Why the session ended, as the harness reported it */
              end_reason: string | null;
              /** @description Rows in messages for this session */
              message_count: number;
              /** @description Tool calls made */
              tool_call_count: number;
              /** @description Input tokens consumed */
              input_tokens: string | null;
              /** @description Output tokens produced */
              output_tokens: string | null;
              /** @description Distinct tool names called; see session_tools */
              tools_used: string[];
              /** @description Files read, edited, written or deleted; see session_files */
              file_count: number;
              /** @description Commits observed during the session */
              observed_commit_count: number;
              /** @description Distinct branches the session worked on */
              observed_branch_count: number;
              /** @description Later sessions that read this one; see session_reuse */
              reuse_count: number;
              /** @description search and sql calls credited to the session while active */
              agentcommons_search_calls: number;
              /** @description Distinct earlier sessions this one read through get; see reuse_edges */
              reuses_made: number;
              /** @description Subagent type when the session is a subagent */
              agent_type: string | null;
              /** @description Parent session of a subagent, fork or spawned session */
              parent_session_id: string | null;
              /** @description SUBAGENT, FORK or SPAWNED */
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
              parent_tool_use_id: string | null;
              /** @description Parent session when visible; null for a root session */
              parent: {
                /**
                 * Format: uuid
                 * @description Related session; pass to get
                 */
                session_id: string;
                /** @description Short title derived from the session */
                title: string | null;
                /** @description SUBAGENT, FORK or SPAWNED */
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
                parent_tool_use_id: string | null;
                /** @description Subagent type when the session is a subagent */
                agent_type: string | null;
              } | null;
              /** @description Up to 10 direct child sessions: subagents, forks and spawned runs */
              children: {
                /**
                 * Format: uuid
                 * @description Related session; pass to get
                 */
                session_id: string;
                /** @description Short title derived from the session */
                title: string | null;
                /** @description SUBAGENT, FORK or SPAWNED */
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
                parent_tool_use_id: string | null;
                /** @description Subagent type when the session is a subagent */
                agent_type: string | null;
              }[];
              /** @description Direct child sessions */
              child_count: number;
              /** @description True when more children exist than are listed */
              children_truncated: boolean;
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
              /**
               * Format: uuid
               * @description Top of this session's parent chain; equals session_id for a root session
               */
              root_session_id: string;
            }[];
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_sessions_id: {
    parameters: {
      query?: {
        /** @description First message seq to return (inclusive) */
        from?: number;
        /** @description Last message seq to return (inclusive) */
        to?: number;
        /** @description The next value of a previous page; omit to start at from */
        cursor?: {
          /** @description Message position (seq) to continue from */
          seq: number;
          /** @description Byte offset inside that message's content */
          offset: number;
        } | null;
        /** @description Message kinds to return, in seq order. Left out: META, the harness's housekeeping records (tool listings, skill listings, reminders); list it to read them. Default TEXT, THINKING, TOOL_USE, TOOL_RESULT */
        kinds?: ("TEXT" | "THINKING" | "TOOL_USE" | "TOOL_RESULT" | "META")[];
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        /** @description Response budget of one page in bytes, 32768 to 262144; each message slice is bounded to one eighth of it */
        page_bytes?: number;
        /** @description Compute and return the session header; false answers header: null for a reader that already holds it, so a later page costs only its messages */
        header?: boolean;
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** @description Who ran the session, where and when, with message, tool, token, file and reuse counts and related sessions; null when the REST caller asked for messages only (header=false) */
            header: {
              /**
               * Format: uuid
               * @description Primary key; every other view joins on it
               */
              session_id: string;
              /** @description Owning organization (already scoped) */
              organization_id: string;
              /** @description Short title derived from the session */
              title: string | null;
              /**
               * @description Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
               * @enum {string}
               */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              /** @description Harness version, if reported */
              harness_version: string | null;
              /** @description How the harness was launched, if reported */
              entrypoint: string | null;
              /** @description Primary model used */
              model: string | null;
              /** @description Every model seen in the session */
              models_used: string[];
              /**
               * Format: email
               * @description Email of the member who ran it
               */
              user_email: string;
              /**
               * @description true when this session's author is another member of your organization
               * @default false
               */
              by_teammate: boolean;
              /** @description Hostname of the capturing machine */
              installation_hostname: string;
              /**
               * Format: uuid
               * @description Machine install that captured it; joins installations.installation_id
               */
              installation_id: string;
              /** @description Repository name such as owner/repo; joins repos.repo_name */
              repo_name: string | null;
              /** @description Remote URL of the repository */
              repo_url: string | null;
              /** @description Git branch last observed in the session */
              branch: string | null;
              /** @description Every distinct branch the session worked on, including switches; see session_observed_branches */
              observed_branches: string[];
              /** @description cwd relative to repo_root */
              cwd_relative: string | null;
              /** @description HEAD SHA at session start */
              start_commit: string | null;
              /** @description HEAD SHA at session end */
              end_commit: string | null;
              /**
               * Format: date-time
               * @description When the session started (UTC)
               */
              started_at: string;
              /** @description When the session ended; NULL while active */
              ended_at: string | null;
              /**
               * @description ACTIVE, ENDED or INACTIVE
               * @enum {string}
               */
              status: "ACTIVE" | "ENDED" | "INACTIVE";
              /**
               * @description PUBLIC or PRIVATE
               * @enum {string}
               */
              visibility: "PUBLIC" | "PRIVATE";
              /** @description When content was purged; NULL otherwise */
              purged_at: string | null;
              /** @description Why the session ended, as the harness reported it */
              end_reason: string | null;
              /** @description Rows in messages for this session */
              message_count: number;
              /** @description Tool calls made */
              tool_call_count: number;
              /** @description Input tokens consumed */
              input_tokens: string | null;
              /** @description Output tokens produced */
              output_tokens: string | null;
              /** @description Distinct tool names called; see session_tools */
              tools_used: string[];
              /** @description Files read, edited, written or deleted; see session_files */
              file_count: number;
              /** @description Commits observed during the session */
              observed_commit_count: number;
              /** @description Distinct branches the session worked on */
              observed_branch_count: number;
              /** @description Later sessions that read this one; see session_reuse */
              reuse_count: number;
              /** @description search and sql calls credited to the session while active */
              agentcommons_search_calls: number;
              /** @description Distinct earlier sessions this one read through get; see reuse_edges */
              reuses_made: number;
              /** @description Subagent type when the session is a subagent */
              agent_type: string | null;
              /** @description Parent session of a subagent, fork or spawned session */
              parent_session_id: string | null;
              /** @description SUBAGENT, FORK or SPAWNED */
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
              parent_tool_use_id: string | null;
              /** @description Parent session when visible; null for a root session */
              parent: {
                /**
                 * Format: uuid
                 * @description Related session; pass to get
                 */
                session_id: string;
                /** @description Short title derived from the session */
                title: string | null;
                /** @description SUBAGENT, FORK or SPAWNED */
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
                parent_tool_use_id: string | null;
                /** @description Subagent type when the session is a subagent */
                agent_type: string | null;
              } | null;
              /** @description Up to 10 direct child sessions: subagents, forks and spawned runs */
              children: {
                /**
                 * Format: uuid
                 * @description Related session; pass to get
                 */
                session_id: string;
                /** @description Short title derived from the session */
                title: string | null;
                /** @description SUBAGENT, FORK or SPAWNED */
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
                parent_tool_use_id: string | null;
                /** @description Subagent type when the session is a subagent */
                agent_type: string | null;
              }[];
              /** @description Direct child sessions */
              child_count: number;
              /** @description True when more children exist than are listed */
              children_truncated: boolean;
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
              /**
               * Format: uuid
               * @description Top of this session's parent chain; equals session_id for a root session
               */
              root_session_id: string;
            } | null;
            /** @description Messages in seq order within the requested range */
            messages: {
              /**
               * Format: uuid
               * @description Primary key of the block
               */
              message_id: string;
              /**
               * Format: uuid
               * @description Session; joins sessions.session_id
               */
              session_id: string;
              /** @description Raw harness record the block came from */
              raw_record_id: string | null;
              /** @description Upload batch that delivered it */
              ingest_batch_id: string | null;
              /** @description Position of the block within the session, ascending; counts every kind, so a read that leaves META out shows gaps */
              seq: number;
              /**
               * @description USER, ASSISTANT, TOOL_RESULT or SYSTEM
               * @enum {string}
               */
              role: "USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM";
              /**
               * @description TEXT, THINKING, TOOL_USE, TOOL_RESULT or META
               * @enum {string}
               */
              kind: "TEXT" | "THINKING" | "TOOL_USE" | "TOOL_RESULT" | "META";
              /** @description Redacted text of the block; tool results and metadata are stored as text */
              content: string;
              /** @description Set when this message's content is bounded here; to read the rest, call get with from and to set to this seq and cursor set to this value */
              content_cursor: {
                /** @description Message position (seq) to continue from */
                seq: number;
                /** @description Byte offset inside that message's content */
                offset: number;
              } | null;
              /** @description Tool called or answered, for TOOL_USE and TOOL_RESULT */
              tool_name: string | null;
              /** @description Harness id pairing a tool call with its result */
              tool_use_id: string | null;
              /** @description Model that produced the block */
              model: string | null;
              /** @description When the harness recorded the block */
              timestamp: string | null;
              /**
               * Format: date-time
               * @description When the server received it
               */
              received_at: string;
              /** @description Input tokens reported for the block */
              input_tokens: string | null;
              /** @description Output tokens reported for the block */
              output_tokens: string | null;
              /** @description Subagent id when a subagent produced the block */
              agent_id: string | null;
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
            }[];
            /** @description Cursor for the following page: the next message, or the rest of the last message when the range ends inside it; null when the range is complete */
            next: {
              /** @description Message position (seq) to continue from */
              seq: number;
              /** @description Byte offset inside that message's content */
              offset: number;
            } | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_sessions_id_raw: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** Format: uuid */
              id: string;
              /** Format: uuid */
              session_id: string;
              organization_id: string;
              pos: string;
              key: string | null;
              source_version: number;
              record_type: string;
              payload: components["schemas"]["JsonValue"];
              payload_fragment: {
                offset: number;
                next_offset: number | null;
              } | null;
              /** Format: uuid */
              ingest_batch_id: string;
              /** Format: date-time */
              received_at: string;
            }[];
            /** @default null */
            cursor: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_sessions_id_tree: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            nodes: {
              /**
               * Format: uuid
               * @description Primary key; every other view joins on it
               */
              session_id: string;
              /** @description Short title derived from the session */
              title: string | null;
              /**
               * @description Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
               * @enum {string}
               */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              /** @description Subagent type when the session is a subagent */
              agent_type: string | null;
              /** @description SUBAGENT, FORK or SPAWNED */
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              /** @description Parent session of a subagent, fork or spawned session */
              parent_session_id: string | null;
              /** @description Parent tool_use_id of the call that spawned this child; NULL when unrecorded */
              parent_tool_use_id: string | null;
              /**
               * Format: email
               * @description Email of the member who ran it
               */
              user_email: string;
              /**
               * Format: date-time
               * @description When the session started (UTC)
               */
              started_at: string;
              /**
               * @description ACTIVE, ENDED or INACTIVE
               * @enum {string}
               */
              status: "ACTIVE" | "ENDED" | "INACTIVE";
              /** @description Rows in messages for this session */
              message_count: number;
              gap: boolean;
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
            }[];
            /** @default null */
            cursor: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_repos: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "repo_name"
          | "session_count"
          | "user_count"
          | "first_seen_at"
          | "last_activity_at";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          repo_name?: string;
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** @description Repository name; matches sessions.repo_name */
              repo_name: string;
              /** @description Remote URL */
              repo_url: string | null;
              /** @description Sessions in the repository */
              session_count: number;
              /** @description Distinct members who ran them */
              user_count: number;
              /**
               * Format: date-time
               * @description Earliest session start
               */
              first_seen_at: string;
              /**
               * Format: date-time
               * @description Latest session activity
               */
              last_activity_at: string;
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_installations: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "hostname"
          | "os_user"
          | "platform"
          | "arch"
          | "first_seen_at"
          | "last_seen_at"
          | "session_count"
          | "tools_enabled";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          hostname?: string;
          tools_enabled?: boolean;
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /**
               * Format: uuid
               * @description Install id; matches sessions.installation_id
               */
              installation_id: string;
              /** @description Whether the AgentCommons MCP tools are installed there */
              tools_enabled: boolean;
              /** @description Owning organization (already scoped) */
              organization_id: string;
              /** @description Machine hostname */
              hostname: string;
              /** @description Operating-system user */
              os_user: string;
              /** @description Operating system, such as darwin or linux */
              platform: string;
              /** @description CPU architecture */
              arch: string;
              /** @description SHA-256 of the installed hook script */
              hook_sha256: string | null;
              /**
               * Format: date-time
               * @description Earliest session start
               */
              first_seen_at: string;
              /**
               * Format: date-time
               * @description Latest session activity
               */
              last_seen_at: string;
              /** @description Visible sessions captured */
              session_count: number;
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_sessions_id_reuse: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?: "read_at" | "reader_email" | "source_title" | "target_title";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        reader_user_id?: string;
        direction?: "by" | "from";
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /**
               * Format: uuid
               * @description Session that did the reading
               */
              source_session_id: string;
              /**
               * Format: uuid
               * @description Session that was read
               */
              target_session_id: string;
              /** @description Title of the reading session */
              source_title: string | null;
              /** @description Title of the session that was read */
              target_title: string | null;
              /** @description Member who ran the reading session */
              reader_user_id: string;
              /** @description Email of that member */
              reader_email: string;
              /**
               * @description Harness of the reading session
               * @enum {string}
               */
              reader_harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              /**
               * Format: date-time
               * @description When the read happened
               */
              read_at: string;
              /**
               * Format: uuid
               * @description Audit event of the read
               */
              audit_id: string;
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
            }[];
            /** @default null */
            cursor: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_me_organizations: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            organizations: {
              id: string;
              name: string;
              slug: string;
              /** @enum {string} */
              role: "owner" | "admin" | "member";
            }[];
            active_organization_id: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_me_organizations: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          name: string;
          slug?: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            organization_id: string;
            created: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_onboarding: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          name: string;
          slug?: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            organization_id: string;
            created: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_me: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            user: {
              id: string;
              /** Format: email */
              email: string;
              name: string;
              email_verified: boolean;
            };
            /** @enum {string} */
            onboarding:
              | "not_applicable"
              | "verify_email"
              | "create_organization"
              | "ready"
              | "contact_admin";
            organization: {
              id: string;
              name: string;
              slug: string;
              /** @enum {string} */
              role: "owner" | "admin" | "member";
            } | null;
            caller: {
              organizationId: string;
              userId: string;
              /** @enum {string} */
              role: "owner" | "admin" | "member";
              apiKeyId: string | null;
              installationId?: string | null;
              toolsEnabled?: boolean;
              /** @enum {string} */
              authMethod: "cookie" | "key";
              permissions: {
                sessions?: ("ingest" | "read")[];
                tools?: ("dashboards" | "administration")[];
                admin?: "*"[];
              };
            } | null;
            key: {
              id: string;
              name: string | null;
            } | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_me_organization: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          organization_id: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            organization: {
              id: string;
              name: string;
              slug: string;
              /** @enum {string} */
              role: "owner" | "admin" | "member";
            };
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_me_keys: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "name"
          | "user_id"
          | "created_at"
          | "expires_at"
          | "last_used_at"
          | "enabled";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          user_id?: string;
          enabled?: boolean;
          /**
           * @description Only keys whose permissions grant this MCP tool group (dashboards, administration)
           * @enum {string}
           */
          tool_group?: "dashboards" | "administration";
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              id: string;
              organization_id: string;
              user_id: string;
              user_email: string | null;
              user_name: string | null;
              name: string | null;
              prefix: string | null;
              permissions: {
                sessions?: ("ingest" | "read")[];
                tools?: ("dashboards" | "administration")[];
                admin?: "*"[];
              };
              enabled: boolean;
              /** Format: date-time */
              created_at: string;
              expires_at: string | null;
              last_used_at: string | null;
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_me_keys: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          name: string;
          permissions: {
            sessions?: ("ingest" | "read")[];
            tools?: ("dashboards" | "administration")[];
            admin?: "*"[];
          };
          expires_in?: number;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            key: string;
            metadata: {
              id: string;
              organization_id: string;
              user_id: string;
              user_email: string | null;
              user_name: string | null;
              name: string | null;
              prefix: string | null;
              permissions: {
                sessions?: ("ingest" | "read")[];
                tools?: ("dashboards" | "administration")[];
                admin?: "*"[];
              };
              enabled: boolean;
              /** Format: date-time */
              created_at: string;
              expires_at: string | null;
              last_used_at: string | null;
            };
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  delete_me_keys_id: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          reason: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            updated: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_me_keys_id_reveal: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": Record<string, never> | null;
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            key: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_tool_policy: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            enabled: boolean;
            rules: {
              id: string;
              description?: string;
              /** @default [] */
              harnesses: ("CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI")[];
              tool: string;
              /** @default [] */
              command_patterns: {
                /** @enum {string} */
                kind: "substring" | "regex";
                value: string;
              }[];
              /** @enum {string} */
              action: "deny" | "warn" | "allow";
              /** @enum {string} */
              severity: "low" | "medium" | "high" | "critical";
            }[];
            revision: number;
            /** Format: date-time */
            updated_at: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_tool_policy_violations: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          violations: {
            /** Format: uuid */
            id?: string;
            /** Format: uuid */
            session_id: string;
            /** @enum {string} */
            harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
            tool: string;
            /** @default null */
            command?: string | null;
            rule_id: string;
            /** @enum {string} */
            decision: "deny" | "warn";
            /** @enum {string} */
            severity: "low" | "medium" | "high" | "critical";
            /** @default null */
            seq?: number | null;
            /** Format: date-time */
            matched_at: string;
          }[];
        };
      };
    };
    responses: {
      /** @description Default Response */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            accepted: number;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_domains: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?: "domain";
        order?: "asc" | "desc";
        domain?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            enabled: boolean;
            items: {
              organization_id: string;
              domain: string;
              provider_id: string;
              verified: boolean;
            }[];
            /** @default null */
            cursor: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_admin_domains: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          domain: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            organization_id: string;
            domain: string;
            provider_id: string;
            verified: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_users: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "email"
          | "name"
          | "role"
          | "suspended"
          | "created_at"
          | "last_seen_at";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          /** Format: email */
          email?: string;
          /** @enum {string} */
          role?: "owner" | "admin" | "member";
          suspended?: boolean;
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              id: string;
              user_id: string;
              organization_id: string;
              /** Format: email */
              email: string;
              name: string;
              /** @enum {string} */
              role: "owner" | "admin" | "member";
              suspended: boolean;
              /** Format: date-time */
              created_at: string;
              last_seen_at: string | null;
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_admin_users: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          emails: string[];
          /** @enum {string} */
          role: "owner" | "admin" | "member";
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            results: {
              /** Format: email */
              email: string;
              /** @enum {string} */
              status: "added" | "existing" | "error";
              user_id: string | null;
              setup_url: string | null;
              error: string | null;
            }[];
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_users_id: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            user_id: string;
            organization_id: string;
            /** Format: email */
            email: string;
            name: string;
            /** @enum {string} */
            role: "owner" | "admin" | "member";
            suspended: boolean;
            /** Format: date-time */
            created_at: string;
            last_seen_at: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  delete_admin_users_id: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          reason: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            updated: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_admin_users_password_setup: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          user_id: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uri */
            setup_url: string;
            /** Format: date-time */
            expires_at: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  patch_admin_users_id_role: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @enum {string} */
          role: "owner" | "admin" | "member";
          reason: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            updated: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  patch_admin_users_id_suspension: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          suspended: boolean;
          reason: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            updated: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_keys: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "name"
          | "user_id"
          | "created_at"
          | "expires_at"
          | "last_used_at"
          | "enabled";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          user_id?: string;
          enabled?: boolean;
          /**
           * @description Only keys whose permissions grant this MCP tool group (dashboards, administration)
           * @enum {string}
           */
          tool_group?: "dashboards" | "administration";
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              id: string;
              organization_id: string;
              user_id: string;
              user_email: string | null;
              user_name: string | null;
              name: string | null;
              prefix: string | null;
              permissions: {
                sessions?: ("ingest" | "read")[];
                tools?: ("dashboards" | "administration")[];
                admin?: "*"[];
              };
              enabled: boolean;
              /** Format: date-time */
              created_at: string;
              expires_at: string | null;
              last_used_at: string | null;
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  delete_admin_keys_id: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          reason: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            updated: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_sessions: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "started_at"
          | "last_activity_at"
          | "user_email"
          | "harness"
          | "status"
          | "visibility"
          | "purged_at";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          /**
           * Format: email
           * @description Sessions run by this member (exact email)
           */
          user_email?: string;
          /**
           * @description Sessions of this coding agent
           * @enum {string}
           */
          harness?: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
          /**
           * @description ACTIVE, ENDED or INACTIVE
           * @enum {string}
           */
          status?: "ACTIVE" | "ENDED" | "INACTIVE";
          /**
           * @description PUBLIC or PRIVATE
           * @enum {string}
           */
          visibility?: "PUBLIC" | "PRIVATE";
          /** @description True: purged sessions only; false: sessions with content */
          purged?: boolean;
          /** @description True: sessions with a published read model; false: sessions still queued, waiting for their transcript or failed */
          published?: boolean;
          /**
           * Format: uuid
           * @description One session by id
           */
          session_id?: string;
          /**
           * Format: date-time
           * @description Sessions started at or after this UTC time (inclusive)
           */
          since?: string;
          /**
           * Format: date-time
           * @description Sessions started before this UTC time (exclusive)
           */
          until?: string;
        };
        roots_only?: boolean;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /**
               * Format: uuid
               * @description Primary key; every other view joins on it
               */
              session_id: string;
              /**
               * @description Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
               * @enum {string}
               */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              /** @description Session id assigned by the harness */
              harness_session_id: string;
              /** @description Email of the member who ran it */
              user_email: string | null;
              /** @description Hostname of the capturing machine */
              installation_hostname: string | null;
              /**
               * Format: date-time
               * @description When the session started (UTC)
               */
              started_at: string;
              /**
               * Format: date-time
               * @description Last captured activity
               */
              last_activity_at: string;
              /** @description When the session ended; NULL while active */
              ended_at: string | null;
              /**
               * @description ACTIVE, ENDED or INACTIVE
               * @enum {string}
               */
              status: "ACTIVE" | "ENDED" | "INACTIVE";
              /**
               * @description PUBLIC or PRIVATE
               * @enum {string}
               */
              visibility: "PUBLIC" | "PRIVATE";
              /** @description When content was purged; NULL otherwise */
              purged_at: string | null;
              /** @description True when a read-model revision is published, so the session appears in sessions, search and sql */
              published: boolean;
              /**
               * @description Where the read model stands: queued, waiting_source (the native transcript has not arrived), published or failed
               * @enum {string}
               */
              projection_state:
                "queued" | "waiting_source" | "published" | "failed";
              /** @description Parent session of a subagent, fork or spawned session */
              parent_session_id: string | null;
              /** @description SUBAGENT, FORK or SPAWNED */
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              /** @description Published title; null for a purged or not yet published session */
              title: string | null;
              /** @description Published repository; null for a purged or not yet published session */
              repo_name: string | null;
              /** @description Published message count; null for a not yet published session */
              message_count: number | null;
            }[];
            /** @default null */
            cursor: string | null;
            /** @description Total over every matching session, computed with the same filters and roots_only as the page */
            total: {
              /** @description Sessions the filters match across every page */
              sessions: number;
            };
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_admin_sessions_id_visibility: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @enum {string} */
          visibility: "PUBLIC" | "PRIVATE";
          reason: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            updated: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_installations: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "hostname"
          | "last_seen_at"
          | "first_seen_at"
          | "up_to_date"
          | "tools_enabled";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          /** @description Machines whose hostname contains this text (ignoring case) */
          hostname?: string;
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /**
               * Format: uuid
               * @description Install id; matches sessions.installation_id
               */
              installation_id: string;
              /** @description Machine hostname */
              hostname: string;
              /** @description Operating-system user */
              os_user: string;
              /** @description Operating system, such as darwin or linux */
              platform: string;
              /** @description CPU architecture */
              arch: string;
              /** @description Whether the AgentCommons MCP tools are installed there */
              tools_enabled: boolean;
              /** @description SHA-256 of the installed hook script */
              hook_sha256: string | null;
              /** @description True when this machine's hook digest matches the served manifest; false when it reports an older digest; null when it has reported no digest or no manifest is served */
              up_to_date: boolean | null;
              /**
               * Format: date-time
               * @description Earliest session start
               */
              first_seen_at: string;
              /**
               * Format: date-time
               * @description Latest session activity
               */
              last_seen_at: string;
            }[];
            /** @default null */
            cursor: string | null;
            /** @description The hook bundle this instance serves at /hook/manifest.json, or null when none is served */
            manifest: {
              /** @description The served bundle version label */
              version: string;
              /** @description The served hook.js digest */
              sha256: string;
            } | null;
            /** @description Freshness counts over every matching installation, unchanged by the page window */
            total: {
              /** @description Installations the filters match across every page */
              installations: number;
              /** @description Installations whose hook digest matches the served bundle */
              up_to_date: number;
              /** @description Installations reporting an older hook digest */
              behind: number;
              /** @description Installations with no reported digest, or every installation when no bundle is served */
              unknown: number;
            };
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_admin_installations_id_tools: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          reason: string;
          enabled: boolean;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            installation_id: string;
            tools_enabled: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_admin_sessions_id_purge: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          reason: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            updated: boolean;
            /** @enum {string} */
            cleanup: "queued" | "completed";
            manifest: {
              deleted: {
                raw_records: number | null;
                messages: number | null;
                session_files: number | null;
                message_chunks: number | null;
                session_embeddings: number | null;
                redaction_events: number;
              };
              nulled_fields: string[];
              reset_fields: string[];
              retained: string[];
            };
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_audit: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "ts"
          | "action"
          | "user_id"
          | "status_code"
          | "duration_ms"
          | "transport"
          | "request_id";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          user_id?: string;
          /** Format: email */
          user_email?: string;
          api_key_id?: string;
          request_id?: string;
          resource_id?: string;
          action?: string;
          /** @enum {string} */
          transport?: "rest" | "mcp" | "web";
          status_code?: number;
          /** Format: date-time */
          since?: string;
          /** Format: date-time */
          until?: string;
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** Format: uuid */
              id: string;
              organization_id: string;
              /** Format: date-time */
              ts: string;
              request_id: string;
              user_id: string | null;
              user_email: string | null;
              api_key_id: string | null;
              installation_id: string | null;
              auth_method: string;
              ip: string;
              user_agent: string | null;
              /** @enum {string} */
              transport: "rest" | "mcp" | "web";
              action: string;
              resource_type: string | null;
              resource_ids: string[];
              status_code: number;
              duration_ms: number;
              detail: components["schemas"]["JsonValue"];
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_metrics_group: {
    parameters: {
      query: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "date"
          | "metric"
          | "value"
          | "repo_name"
          | "user_id"
          | "harness"
          | "tool"
          | "tools_enabled";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters: {
          /** Format: date-time */
          date_from?: string;
          /** Format: date-time */
          date_to?: string;
          repo_name?: string;
          /** @enum {string} */
          metric?:
            | "reuse_rate"
            | "cross_user_reuse_rate"
            | "capture_coverage"
            | "sessions"
            | "capture_latency_seconds"
            | "negative_capture_latency_records"
            | "authorization_blocked_sessions"
            | "redaction_hits"
            | "agentcommons_search_sessions"
            | "agentcommons_search_rate"
            | "agentcommons_search_calls"
            | "repeat_agentcommons_search_calls"
            | "mcp_calls"
            | "memory_assisted_rate"
            | "follow_through_rate"
            | "zero_result_rate"
            | "cross_user_hit_rate"
            | "dashboard_weekly_actives"
            | "dashboard_searches"
            | "dashboard_session_views"
            | "tool_calls_per_session"
            | "tokens_per_session"
            | "duration_seconds_per_session"
            | "near_duplicate_rate"
            | "rerun_loop_rate"
            | "observed_commit_rate";
        };
      };
      header?: never;
      path: {
        group: "reuse" | "health" | "usage" | "outcomes";
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** @enum {string} */
              metric:
                | "reuse_rate"
                | "cross_user_reuse_rate"
                | "capture_coverage"
                | "sessions"
                | "capture_latency_seconds"
                | "negative_capture_latency_records"
                | "authorization_blocked_sessions"
                | "redaction_hits"
                | "agentcommons_search_sessions"
                | "agentcommons_search_rate"
                | "agentcommons_search_calls"
                | "repeat_agentcommons_search_calls"
                | "mcp_calls"
                | "memory_assisted_rate"
                | "follow_through_rate"
                | "zero_result_rate"
                | "cross_user_hit_rate"
                | "dashboard_weekly_actives"
                | "dashboard_searches"
                | "dashboard_session_views"
                | "tool_calls_per_session"
                | "tokens_per_session"
                | "duration_seconds_per_session"
                | "near_duplicate_rate"
                | "rerun_loop_rate"
                | "observed_commit_rate";
              date: string | null;
              repo_name: string | null;
              harness: string | null;
              user_id: string | null;
              tool: string | null;
              policy_id: string | null;
              tools_enabled: boolean | null;
              value: number | null;
              numerator: number | null;
              denominator: number | null;
              /** @enum {string} */
              unit:
                | "count"
                | "ratio"
                | "seconds"
                | "milliseconds"
                | "tokens"
                | "usd";
              /**
               * @description Fields shortened to fit the response
               * @default []
               */
              truncated_fields: string[];
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_status: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            server: {
              version: string;
              auto_update: boolean;
              updater: {
                last_check: string | null;
                last_ok: string | null;
                last_result: string | null;
                last_image: string | null;
                previous_image: string | null;
                updated_at: string | null;
                failed_image: string | null;
                failed_at: string | null;
                failures: number;
                running_revision: string | null;
                running_created: string | null;
                pulled_revision: string | null;
                pulled_created: string | null;
              } | null;
            };
            projection: {
              queued_sessions: number;
              outbox_batches: number;
              oldest_accepted_at: string | null;
              failed_sessions: number;
              waiting_source_sessions: number;
              pending_audit_events: number;
            };
            ingest_per_day: {
              /** Format: date */
              date: string;
              count: number;
            }[];
            redaction_hits: {
              policy_id: string;
              count: number;
            }[];
            failures: {
              /** Format: date */
              date: string;
              count: number;
            }[];
            queue_depth: number;
            embedding_backlog: number;
            embedding_daily_tokens: string;
            embedding_daily_cost: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_redaction_policies: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          "name" | "kind" | "enabled" | "builtin" | "created_at" | "updated_at";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          name?: string;
          /** @enum {string} */
          kind?: "REGEX" | "SECRETLINT_RULE";
          enabled?: boolean;
          builtin?: boolean;
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** Format: uuid */
              id: string;
              organization_id: string;
              name: string;
              /** @enum {string} */
              kind: "REGEX" | "SECRETLINT_RULE";
              pattern: string | null;
              flags: string | null;
              rule_id: string | null;
              options: components["schemas"]["JsonValue"] | null;
              replacement: string;
              enabled: boolean;
              builtin: boolean;
              created_by_user_id: string | null;
              /** Format: date-time */
              created_at: string;
              /** Format: date-time */
              updated_at: string;
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_admin_redaction_policies: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json":
          | {
              name: string;
              replacement?: string;
              /** @default true */
              enabled?: boolean;
              /** @enum {string} */
              kind: "REGEX";
              pattern: string;
              /** @default g */
              flags?: string;
            }
          | {
              name: string;
              replacement?: string;
              /** @default true */
              enabled?: boolean;
              /** @enum {string} */
              kind: "SECRETLINT_RULE";
              /** @enum {string} */
              ruleId:
                | "@secretlint/secretlint-rule-preset-recommend"
                | "@secretlint/secretlint-rule-aws"
                | "@secretlint/secretlint-rule-gcp"
                | "@secretlint/secretlint-rule-privatekey"
                | "@secretlint/secretlint-rule-npm"
                | "@secretlint/secretlint-rule-basicauth"
                | "@secretlint/secretlint-rule-slack"
                | "@secretlint/secretlint-rule-sendgrid"
                | "@secretlint/secretlint-rule-shopify"
                | "@secretlint/secretlint-rule-stripe"
                | "@secretlint/secretlint-rule-github"
                | "@secretlint/secretlint-rule-gitlab"
                | "@secretlint/secretlint-rule-grafana"
                | "@secretlint/secretlint-rule-openai"
                | "@secretlint/secretlint-rule-anthropic"
                | "@secretlint/secretlint-rule-groq"
                | "@secretlint/secretlint-rule-huggingface"
                | "@secretlint/secretlint-rule-linear"
                | "@secretlint/secretlint-rule-notion"
                | "@secretlint/secretlint-rule-1password"
                | "@secretlint/secretlint-rule-database-connection-string"
                | "@secretlint/secretlint-rule-hashicorp-vault"
                | "@secretlint/secretlint-rule-vercel"
                | "@secretlint/secretlint-rule-databricks"
                | "@secretlint/secretlint-rule-docker"
                | "@secretlint/secretlint-rule-figma"
                | "@secretlint/secretlint-rule-cloudflare"
                | "@secretlint/secretlint-rule-tailscale";
              /** @default {} */
              options?: {
                allows?: string[];
              };
            };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            id: string;
            organization_id: string;
            name: string;
            /** @enum {string} */
            kind: "REGEX" | "SECRETLINT_RULE";
            pattern: string | null;
            flags: string | null;
            rule_id: string | null;
            options: components["schemas"]["JsonValue"] | null;
            replacement: string;
            enabled: boolean;
            builtin: boolean;
            created_by_user_id: string | null;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  delete_admin_redaction_policies_id: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          reason: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            updated: boolean;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  patch_admin_redaction_policies_id: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json":
          | {
              name: string;
              replacement?: string;
              /** @default true */
              enabled?: boolean;
              /** @enum {string} */
              kind: "REGEX";
              pattern: string;
              /** @default g */
              flags?: string;
            }
          | {
              name: string;
              replacement?: string;
              /** @default true */
              enabled?: boolean;
              /** @enum {string} */
              kind: "SECRETLINT_RULE";
              /** @enum {string} */
              ruleId:
                | "@secretlint/secretlint-rule-preset-recommend"
                | "@secretlint/secretlint-rule-aws"
                | "@secretlint/secretlint-rule-gcp"
                | "@secretlint/secretlint-rule-privatekey"
                | "@secretlint/secretlint-rule-npm"
                | "@secretlint/secretlint-rule-basicauth"
                | "@secretlint/secretlint-rule-slack"
                | "@secretlint/secretlint-rule-sendgrid"
                | "@secretlint/secretlint-rule-shopify"
                | "@secretlint/secretlint-rule-stripe"
                | "@secretlint/secretlint-rule-github"
                | "@secretlint/secretlint-rule-gitlab"
                | "@secretlint/secretlint-rule-grafana"
                | "@secretlint/secretlint-rule-openai"
                | "@secretlint/secretlint-rule-anthropic"
                | "@secretlint/secretlint-rule-groq"
                | "@secretlint/secretlint-rule-huggingface"
                | "@secretlint/secretlint-rule-linear"
                | "@secretlint/secretlint-rule-notion"
                | "@secretlint/secretlint-rule-1password"
                | "@secretlint/secretlint-rule-database-connection-string"
                | "@secretlint/secretlint-rule-hashicorp-vault"
                | "@secretlint/secretlint-rule-vercel"
                | "@secretlint/secretlint-rule-databricks"
                | "@secretlint/secretlint-rule-docker"
                | "@secretlint/secretlint-rule-figma"
                | "@secretlint/secretlint-rule-cloudflare"
                | "@secretlint/secretlint-rule-tailscale";
              /** @default {} */
              options?: {
                allows?: string[];
              };
            };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            /** Format: uuid */
            id: string;
            organization_id: string;
            name: string;
            /** @enum {string} */
            kind: "REGEX" | "SECRETLINT_RULE";
            pattern: string | null;
            flags: string | null;
            rule_id: string | null;
            options: components["schemas"]["JsonValue"] | null;
            replacement: string;
            enabled: boolean;
            builtin: boolean;
            created_by_user_id: string | null;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_admin_redaction_test: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          text: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            text: string;
            matches: {
              policy_id: string;
              count: number;
            }[];
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_redaction_summary: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            total: number;
            sessions: number;
            last_7_days: {
              capture: number;
              rescan: number;
              total: number;
            };
            last_30_days: {
              capture: number;
              rescan: number;
              total: number;
            };
            by_policy: {
              /** Format: uuid */
              policy_id: string;
              name: string;
              /** @enum {string} */
              kind: "REGEX" | "SECRETLINT_RULE";
              enabled: boolean;
              count: number;
              sessions: number;
              distinct_secrets: number;
            }[];
            runs: {
              total: number;
              active: number;
              failed: number;
            };
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_redaction_hits: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?: "redacted_at" | "count" | "seq";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          /** Format: uuid */
          run_id?: string;
          /** Format: uuid */
          session_id?: string;
          /** Format: uuid */
          policy_id?: string;
          /** @enum {string} */
          source?: "capture" | "rescan";
          q?: string;
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** Format: uuid */
              id: string;
              /** Format: uuid */
              session_id: string;
              /** Format: uuid */
              ingest_batch_id: string;
              run_id: string | null;
              /** @enum {string} */
              source: "capture" | "rescan";
              /** Format: uuid */
              policy_id: string;
              policy_name: string | null;
              seq: number | null;
              count: number;
              masked_preview: string | null;
              fingerprint: string | null;
              match_length: number | null;
              /** Format: date-time */
              redacted_at: string;
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_redaction_rescan: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?: "created_at" | "state" | "redaction_count" | "total_sessions";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** Format: uuid */
              id: string;
              /** @enum {string} */
              state: "queued" | "running" | "completed" | "failed";
              /** Format: date-time */
              created_at: string;
              /** Format: date-time */
              updated_at: string;
              total_sessions: number;
              processed_sessions: number;
              changed_sessions: number;
              redaction_count: number;
              error: string | null;
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  post_admin_redaction_rescan: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          policyIds?: string[];
          /** Format: date-time */
          since?: string;
          reason: string;
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            job_id: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_redaction_rescan_id: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            job_id: string;
            /** @enum {string} */
            state: "queued" | "running" | "completed" | "failed";
            total_sessions: number;
            processed_sessions: number;
            redaction_count: number;
            error: string | null;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_redaction_rescan_id_sessions: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?: "processed_at" | "redaction_count";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          /** @default true */
          changed?: boolean;
        };
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** Format: uuid */
              run_id: string;
              /** Format: uuid */
              session_id: string;
              processed_at: string | null;
              redaction_count: number;
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_tool_policy: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            enabled: boolean;
            rules: {
              id: string;
              description?: string;
              /** @default [] */
              harnesses: ("CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI")[];
              tool: string;
              /** @default [] */
              command_patterns: {
                /** @enum {string} */
                kind: "substring" | "regex";
                value: string;
              }[];
              /** @enum {string} */
              action: "deny" | "warn" | "allow";
              /** @enum {string} */
              severity: "low" | "medium" | "high" | "critical";
            }[];
            revision: number;
            /** Format: date-time */
            updated_at: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  put_admin_tool_policy: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @default false */
          enabled?: boolean;
          /** @default [] */
          rules?: {
            id: string;
            description?: string;
            /** @default [] */
            harnesses?: ("CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI")[];
            tool: string;
            /** @default [] */
            command_patterns?: {
              /** @enum {string} */
              kind: "substring" | "regex";
              value: string;
            }[];
            /** @enum {string} */
            action: "deny" | "warn" | "allow";
            /** @enum {string} */
            severity: "low" | "medium" | "high" | "critical";
          }[];
        };
      };
    };
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            enabled: boolean;
            rules: {
              id: string;
              description?: string;
              /** @default [] */
              harnesses: ("CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI")[];
              tool: string;
              /** @default [] */
              command_patterns: {
                /** @enum {string} */
                kind: "substring" | "regex";
                value: string;
              }[];
              /** @enum {string} */
              action: "deny" | "warn" | "allow";
              /** @enum {string} */
              severity: "low" | "medium" | "high" | "critical";
            }[];
            revision: number;
            /** Format: date-time */
            updated_at: string;
          };
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
  get_admin_tool_policy_violations: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?: "matched_at" | "seq";
        order?: "asc" | "desc";
        /** @description Response format: json, or csv for a text/csv export */
        format?: "json" | "csv";
        filters?: {
          /** Format: uuid */
          session_id?: string;
          /** @enum {string} */
          source?: "projection" | "hook";
          /** @enum {string} */
          harness?: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
          rule_id?: string;
          /** @enum {string} */
          decision?: "deny" | "warn" | "allow";
          /** @enum {string} */
          severity?: "low" | "medium" | "high" | "critical";
          enforced?: boolean;
        };
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: {
              /** Format: uuid */
              id: string;
              /** Format: uuid */
              session_id: string;
              /** @enum {string} */
              source: "projection" | "hook";
              seq: number | null;
              /** @enum {string} */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              tool: string;
              rule_id: string | null;
              /** @enum {string} */
              decision: "deny" | "warn" | "allow";
              severity: ("low" | "medium" | "high" | "critical") | null;
              enforced: boolean;
              masked_command: string | null;
              fingerprint: string | null;
              /** Format: date-time */
              matched_at: string;
            }[];
            /** @default null */
            cursor: string | null;
          };
          "text/csv": string;
        };
      };
      /** @description Default Response */
      "4XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
      /** @description Default Response */
      "5XX": {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            code: string;
            message: string;
            position?: number | null;
            detail?: components["schemas"]["JsonValue"];
          };
        };
      };
    };
  };
}
