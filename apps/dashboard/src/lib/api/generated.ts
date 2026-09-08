// Generated from the server OpenAPI contract. Do not edit.
import type { JsonValue } from "@agentcommons/core/schemas/common";
export interface paths {
  "/api/v1/me/dashboards": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List personal dashboards and their declaration schema */
    get: operations["get_me_dashboards"];
    put?: never;
    /** Create or update a personal dashboard */
    post: operations["post_me_dashboards"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/me/dashboards/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Delete a personal dashboard */
    delete: operations["delete_me_dashboards_id"];
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
  "/api/v1/home": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the organization's reuse summary and your impact */
    get: operations["get_home"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/home/{section}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Browse visible reuse activity and your corpus gaps */
    get: operations["get_home_section"];
    put?: never;
    post?: never;
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
    /** Register a Google SSO domain and return its DNS proof */
    post: operations["post_admin_domains"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/admin/domains/verify": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Verify Google SSO domain DNS ownership */
    post: operations["post_admin_domains_verify"];
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
  "/api/v1/admin/users/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Remove an organization member */
    delete: operations["delete_admin_users_id"];
    options?: never;
    head?: never;
    patch?: never;
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
  "/api/v1/admin/redaction/rescan": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Rescan existing organization records */
    post: operations["post_admin_redaction_rescan"];
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
    JsonValue: JsonValue;
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  get_me_dashboards: {
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
              user_id: string;
              name: string;
              definition: {
                /** @enum {number} */
                version: 1;
                widgets: {
                  id: string;
                  title: string;
                  sql: string;
                  /** @enum {string} */
                  display: "number" | "line" | "bar" | "table";
                  x?: string;
                  y?: string;
                  /** @enum {string} */
                  unit: "count" | "ratio" | "seconds" | "tokens" | "usd";
                }[];
              };
              revision: number;
              /** Format: date-time */
              updated_at: string;
            }[];
            definition_schema: components["schemas"]["JsonValue"];
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
  post_me_dashboards: {
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
          definition: {
            /** @enum {number} */
            version: 1;
            widgets: {
              id: string;
              title: string;
              sql: string;
              /** @enum {string} */
              display: "number" | "line" | "bar" | "table";
              x?: string;
              y?: string;
              /** @enum {string} */
              unit: "count" | "ratio" | "seconds" | "tokens" | "usd";
            }[];
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
            user_id: string;
            name: string;
            definition: {
              /** @enum {number} */
              version: 1;
              widgets: {
                id: string;
                title: string;
                sql: string;
                /** @enum {string} */
                display: "number" | "line" | "bar" | "table";
                x?: string;
                y?: string;
                /** @enum {string} */
                unit: "count" | "ratio" | "seconds" | "tokens" | "usd";
              }[];
            };
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
  delete_me_dashboards_id: {
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
  get_home: {
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
            /** Format: date */
            week: string;
            weekly: {
              /** Format: date */
              week: string;
              sessions: number;
              reuse_sessions: number;
              cross_user_reuse_sessions: number;
              reuse_rate: number | null;
              cross_user_reuse_rate: number | null;
            }[];
            impact: {
              user_id: string;
              sessions_reused_by_others: number;
              distinct_readers: number;
              reuses_made: number;
            };
            search_adoption: {
              sessions: number;
              agentcommons_search_sessions: number;
              agentcommons_search_rate: number | null;
              agentcommons_search_calls: number;
              repeat_agentcommons_search_calls: number;
              subsequent_other_search_calls: number;
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
  get_home_section: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?:
          | "read_at"
          | "reader_email"
          | "source_title"
          | "target_title"
          | "sessions"
          | "repo_name"
          | "searched_at"
          | "query";
        order?: "asc" | "desc";
        format?: "json" | "csv";
        reader_user_id?: string;
        query?: string;
      };
      header?: never;
      path: {
        section:
          "reused" | "inbound" | "outbound" | "gap_repos" | "zero_results";
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
            items: (
              | {
                  /** Format: uuid */
                  source_session_id: string;
                  /** Format: uuid */
                  target_session_id: string;
                  source_title: string | null;
                  target_title: string | null;
                  reader_user_id: string;
                  reader_email: string;
                  /** @enum {string} */
                  reader_harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
                  /** Format: date-time */
                  read_at: string;
                  /** Format: uuid */
                  audit_id: string;
                  truncated_fields: string[];
                }
              | {
                  repo_name: string;
                  sessions: number;
                  truncated_fields: string[];
                }
              | {
                  /** Format: uuid */
                  search_id: string;
                  /** Format: date-time */
                  searched_at: string;
                  query: string;
                  truncated_fields: string[];
                }
            )[];
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
          query: string;
          /** @default {} */
          filters?: {
            repo_name?: string | string[];
            branch?: string | string[];
            user_email?: string | string[];
            tool_name?: string | string[];
            file_prefix?: string | string[];
            role?:
              | ("USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM")
              | ("USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM")[];
            session_id?: string | string[];
            since?: string | string[];
            until?: string | string[];
            where?: (
              | {
                  /** @enum {string} */
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
                  path?: string[];
                  /** @enum {string} */
                  op: "eq";
                  value: string | number | boolean | null;
                }
              | {
                  /** @enum {string} */
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
                  path?: string[];
                  /** @enum {string} */
                  op: "contains";
                  value: string;
                }
              | {
                  /** @enum {string} */
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
                  path?: string[];
                  /** @enum {string} */
                  op: "starts_with";
                  value: string;
                }
              | {
                  /** @enum {string} */
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
                  path?: string[];
                  /** @enum {string} */
                  op: "exists";
                }
            )[];
          };
          /** @default 1 */
          context?: number;
          /** @default 5 */
          limit?: number;
          /** @default null */
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
            blocks: {
              /** Format: uuid */
              session_id: string;
              title: string | null;
              /** @enum {string} */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              model: string | null;
              repo_name: string | null;
              branch: string | null;
              /** Format: email */
              user_email: string;
              /** Format: date-time */
              started_at: string;
              messages: {
                seq: number;
                /** @enum {string} */
                role: "USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM";
                /** @enum {string} */
                kind: "TEXT" | "THINKING" | "TOOL_USE" | "TOOL_RESULT" | "META";
                tool_name?: string | null;
                tool_use_id?: string | null;
                content: string;
                hit: boolean;
                truncated: boolean;
                /** @default [] */
                truncated_fields: string[];
              }[];
              /** @default [] */
              truncated_fields: string[];
            }[];
            /** @default null */
            cursor: string | null;
            truncated_response: boolean;
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
          | "status"
          | "last_activity_at";
        order?: "asc" | "desc";
        format?: "json" | "csv";
        filters?: {
          repo_name?: string | string[];
          branch?: string | string[];
          user_email?: string | string[];
          tool_name?: string | string[];
          file_prefix?: string | string[];
          role?:
            | ("USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM")
            | ("USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM")[];
          session_id?: string | string[];
          since?: string | string[];
          until?: string | string[];
          where?: (
            | {
                /** @enum {string} */
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
                path?: string[];
                /** @enum {string} */
                op: "eq";
                value: string | number | boolean | null;
              }
            | {
                /** @enum {string} */
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
                path?: string[];
                /** @enum {string} */
                op: "contains";
                value: string;
              }
            | {
                /** @enum {string} */
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
                path?: string[];
                /** @enum {string} */
                op: "starts_with";
                value: string;
              }
            | {
                /** @enum {string} */
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
                path?: string[];
                /** @enum {string} */
                op: "exists";
              }
          )[];
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
              session_id: string;
              organization_id: string;
              title: string | null;
              /** @enum {string} */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              harness_version: string | null;
              entrypoint: string | null;
              model: string | null;
              models_used: string[];
              /** Format: email */
              user_email: string;
              installation_hostname: string;
              /** Format: uuid */
              installation_id: string;
              repo_name: string | null;
              repo_url: string | null;
              branch: string | null;
              cwd_relative: string | null;
              start_commit: string | null;
              end_commit: string | null;
              /** Format: date-time */
              started_at: string;
              ended_at: string | null;
              /** @enum {string} */
              status: "ACTIVE" | "ENDED" | "INACTIVE";
              /** @enum {string} */
              visibility: "PUBLIC" | "PRIVATE";
              end_reason: string | null;
              message_count: number;
              tool_call_count: number;
              input_tokens: string | null;
              output_tokens: string | null;
              tools_used: string[];
              file_count: number;
              observed_commit_count: number;
              reuse_count: number;
              agent_type: string | null;
              parent_session_id: string | null;
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              parent: {
                /** Format: uuid */
                session_id: string;
                title: string | null;
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                agent_type: string | null;
              } | null;
              children: {
                /** Format: uuid */
                session_id: string;
                title: string | null;
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                agent_type: string | null;
              }[];
              child_count: number;
              children_truncated: boolean;
              truncated_fields: string[];
              /** Format: uuid */
              root_session_id: string;
              duration_seconds: number | null;
              /** Format: date-time */
              last_activity_at: string;
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
              /** Format: uuid */
              session_id: string;
              organization_id: string;
              title: string | null;
              /** @enum {string} */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              harness_version: string | null;
              entrypoint: string | null;
              model: string | null;
              models_used: string[];
              /** Format: email */
              user_email: string;
              installation_hostname: string;
              /** Format: uuid */
              installation_id: string;
              repo_name: string | null;
              repo_url: string | null;
              branch: string | null;
              cwd_relative: string | null;
              start_commit: string | null;
              end_commit: string | null;
              /** Format: date-time */
              started_at: string;
              ended_at: string | null;
              /** @enum {string} */
              status: "ACTIVE" | "ENDED" | "INACTIVE";
              /** @enum {string} */
              visibility: "PUBLIC" | "PRIVATE";
              end_reason: string | null;
              message_count: number;
              tool_call_count: number;
              input_tokens: string | null;
              output_tokens: string | null;
              tools_used: string[];
              file_count: number;
              observed_commit_count: number;
              reuse_count: number;
              agent_type: string | null;
              parent_session_id: string | null;
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              parent: {
                /** Format: uuid */
                session_id: string;
                title: string | null;
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                agent_type: string | null;
              } | null;
              children: {
                /** Format: uuid */
                session_id: string;
                title: string | null;
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                agent_type: string | null;
              }[];
              child_count: number;
              children_truncated: boolean;
              truncated_fields: string[];
              /** Format: uuid */
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
        from?: number;
        to?: number;
        cursor?: {
          seq: number;
          offset: number;
        } | null;
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
            header: {
              /** Format: uuid */
              session_id: string;
              organization_id: string;
              title: string | null;
              /** @enum {string} */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              harness_version: string | null;
              entrypoint: string | null;
              model: string | null;
              models_used: string[];
              /** Format: email */
              user_email: string;
              installation_hostname: string;
              /** Format: uuid */
              installation_id: string;
              repo_name: string | null;
              repo_url: string | null;
              branch: string | null;
              cwd_relative: string | null;
              start_commit: string | null;
              end_commit: string | null;
              /** Format: date-time */
              started_at: string;
              ended_at: string | null;
              /** @enum {string} */
              status: "ACTIVE" | "ENDED" | "INACTIVE";
              /** @enum {string} */
              visibility: "PUBLIC" | "PRIVATE";
              end_reason: string | null;
              message_count: number;
              tool_call_count: number;
              input_tokens: string | null;
              output_tokens: string | null;
              tools_used: string[];
              file_count: number;
              observed_commit_count: number;
              reuse_count: number;
              agent_type: string | null;
              parent_session_id: string | null;
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              parent: {
                /** Format: uuid */
                session_id: string;
                title: string | null;
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                agent_type: string | null;
              } | null;
              children: {
                /** Format: uuid */
                session_id: string;
                title: string | null;
                parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
                agent_type: string | null;
              }[];
              child_count: number;
              children_truncated: boolean;
              truncated_fields: string[];
              /** Format: uuid */
              root_session_id: string;
            };
            messages: {
              /** Format: uuid */
              message_id: string;
              /** Format: uuid */
              session_id: string;
              raw_record_id: string | null;
              ingest_batch_id: string | null;
              seq: number;
              /** @enum {string} */
              role: "USER" | "ASSISTANT" | "TOOL_RESULT" | "SYSTEM";
              /** @enum {string} */
              kind: "TEXT" | "THINKING" | "TOOL_USE" | "TOOL_RESULT" | "META";
              content: string;
              content_cursor: {
                seq: number;
                offset: number;
              } | null;
              tool_name: string | null;
              tool_use_id: string | null;
              model: string | null;
              timestamp: string | null;
              /** Format: date-time */
              received_at: string;
              input_tokens: string | null;
              output_tokens: string | null;
              agent_id: string | null;
              /** @default [] */
              truncated_fields: string[];
            }[];
            next: {
              seq: number;
              offset: number;
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
              /** Format: uuid */
              session_id: string;
              title: string | null;
              /** @enum {string} */
              harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              agent_type: string | null;
              parent_relation: ("SUBAGENT" | "FORK" | "SPAWNED") | null;
              parent_session_id: string | null;
              /** Format: email */
              user_email: string;
              /** Format: date-time */
              started_at: string;
              /** @enum {string} */
              status: "ACTIVE" | "ENDED" | "INACTIVE";
              message_count: number;
              gap: boolean;
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
              repo_name: string;
              repo_url: string | null;
              session_count: number;
              user_count: number;
              /** Format: date-time */
              first_seen_at: string;
              /** Format: date-time */
              last_activity_at: string;
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
              /** Format: uuid */
              installation_id: string;
              tools_enabled: boolean;
              organization_id: string;
              hostname: string;
              os_user: string;
              platform: string;
              arch: string;
              /** Format: date-time */
              first_seen_at: string;
              /** Format: date-time */
              last_seen_at: string;
              session_count: number;
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
              /** Format: uuid */
              source_session_id: string;
              /** Format: uuid */
              target_session_id: string;
              source_title: string | null;
              target_title: string | null;
              reader_user_id: string;
              reader_email: string;
              /** @enum {string} */
              reader_harness: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
              /** Format: date-time */
              read_at: string;
              /** Format: uuid */
              audit_id: string;
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
  get_admin_domains: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        domain?: string;
        verified?: "true" | "false";
        sort?: "domain" | "verified";
        order?: "asc" | "desc";
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
              dns_record: {
                /** @enum {string} */
                type: "TXT";
                name: string;
                value: string;
              } | null;
            }[];
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
            dns_record: {
              /** @enum {string} */
              type: "TXT";
              name: string;
              value: string;
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
  post_admin_domains_verify: {
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
            dns_record: {
              /** @enum {string} */
              type: "TXT";
              name: string;
              value: string;
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
          slug: string;
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
          slug: string;
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
        format?: "json" | "csv";
        filters?: {
          user_id?: string;
          enabled?: boolean;
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
  get_admin_users: {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string | null;
        sort?: "email" | "name" | "role" | "suspended" | "created_at";
        order?: "asc" | "desc";
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
        format?: "json" | "csv";
        filters?: {
          user_id?: string;
          enabled?: boolean;
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
        format?: "json" | "csv";
        filters?: {
          user_id?: string;
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
            | "subsequent_other_search_calls"
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
                | "subsequent_other_search_calls"
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
              unit: "count" | "ratio" | "seconds" | "tokens" | "usd";
              /** @default [] */
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
}
