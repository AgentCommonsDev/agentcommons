# 0019. Keep deployment disabled until the operator enables it

Status: accepted, 2026-09-08.

The implementation request explicitly defers deployment until local verification and
user confirmation. Pushing the completed implementation must therefore not implicitly
deploy it through the successful-main CI workflow.

The deployment job requires repository variable `DEPLOYMENTS_ENABLED=true`, including
manual releases. The default is unset and performs no deployment. Once an operator
enables it, the specified workflow applies: successful main CI deploys its exact
commit to dev; production uses the protected GitHub environment and manual release.
Read-only PR previews retain their separate OIDC role. No cloud resources are created
as part of this implementation turn.
