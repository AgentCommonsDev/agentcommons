from typing import Literal

PatchAdminRedactionPoliciesIdBodyType1RuleId = Literal[
    "@secretlint/secretlint-rule-1password",
    "@secretlint/secretlint-rule-anthropic",
    "@secretlint/secretlint-rule-aws",
    "@secretlint/secretlint-rule-basicauth",
    "@secretlint/secretlint-rule-cloudflare",
    "@secretlint/secretlint-rule-database-connection-string",
    "@secretlint/secretlint-rule-databricks",
    "@secretlint/secretlint-rule-docker",
    "@secretlint/secretlint-rule-figma",
    "@secretlint/secretlint-rule-gcp",
    "@secretlint/secretlint-rule-github",
    "@secretlint/secretlint-rule-gitlab",
    "@secretlint/secretlint-rule-grafana",
    "@secretlint/secretlint-rule-groq",
    "@secretlint/secretlint-rule-hashicorp-vault",
    "@secretlint/secretlint-rule-huggingface",
    "@secretlint/secretlint-rule-linear",
    "@secretlint/secretlint-rule-notion",
    "@secretlint/secretlint-rule-npm",
    "@secretlint/secretlint-rule-openai",
    "@secretlint/secretlint-rule-preset-recommend",
    "@secretlint/secretlint-rule-privatekey",
    "@secretlint/secretlint-rule-sendgrid",
    "@secretlint/secretlint-rule-shopify",
    "@secretlint/secretlint-rule-slack",
    "@secretlint/secretlint-rule-stripe",
    "@secretlint/secretlint-rule-tailscale",
    "@secretlint/secretlint-rule-vercel",
]

PATCH_ADMIN_REDACTION_POLICIES_ID_BODY_TYPE_1_RULE_ID_VALUES: set[
    PatchAdminRedactionPoliciesIdBodyType1RuleId
] = {
    "@secretlint/secretlint-rule-1password",
    "@secretlint/secretlint-rule-anthropic",
    "@secretlint/secretlint-rule-aws",
    "@secretlint/secretlint-rule-basicauth",
    "@secretlint/secretlint-rule-cloudflare",
    "@secretlint/secretlint-rule-database-connection-string",
    "@secretlint/secretlint-rule-databricks",
    "@secretlint/secretlint-rule-docker",
    "@secretlint/secretlint-rule-figma",
    "@secretlint/secretlint-rule-gcp",
    "@secretlint/secretlint-rule-github",
    "@secretlint/secretlint-rule-gitlab",
    "@secretlint/secretlint-rule-grafana",
    "@secretlint/secretlint-rule-groq",
    "@secretlint/secretlint-rule-hashicorp-vault",
    "@secretlint/secretlint-rule-huggingface",
    "@secretlint/secretlint-rule-linear",
    "@secretlint/secretlint-rule-notion",
    "@secretlint/secretlint-rule-npm",
    "@secretlint/secretlint-rule-openai",
    "@secretlint/secretlint-rule-preset-recommend",
    "@secretlint/secretlint-rule-privatekey",
    "@secretlint/secretlint-rule-sendgrid",
    "@secretlint/secretlint-rule-shopify",
    "@secretlint/secretlint-rule-slack",
    "@secretlint/secretlint-rule-stripe",
    "@secretlint/secretlint-rule-tailscale",
    "@secretlint/secretlint-rule-vercel",
}


def check_patch_admin_redaction_policies_id_body_type_1_rule_id(
    value: str,
) -> PatchAdminRedactionPoliciesIdBodyType1RuleId:
    if value in PATCH_ADMIN_REDACTION_POLICIES_ID_BODY_TYPE_1_RULE_ID_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PATCH_ADMIN_REDACTION_POLICIES_ID_BODY_TYPE_1_RULE_ID_VALUES!r}"
    )
