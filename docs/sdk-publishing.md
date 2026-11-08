# Publishing the SDKs

The [SDK release workflow](../.github/workflows/release-sdks.yml) publishes
`@agentcommons/sdk` to npm and `agentcommons` to PyPI when a maintainer pushes an
`sdk-vX.Y.Z` tag. The tag must point to a commit on `main`, and both package versions
must match it. Merging a PR does not publish packages.

## Configure the registries once

Create GitHub environments named `npm` and `pypi`. The workflow uses these names
when requesting registry credentials.

For npm, the publishing account needs access to the `@agentcommons` scope. For the
first release, set a publishing token as the `NPM_TOKEN` secret in the `npm` GitHub
environment. Once the package exists, configure its trusted publisher with GitHub
owner `AgentCommonsDev`, repository `agentcommons`, workflow `release-sdks.yml` and
environment `npm`. Enable direct `npm publish` for that publisher, then remove
`NPM_TOKEN`. Later releases use GitHub's OIDC identity and include provenance.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

For PyPI, create a pending trusted publisher for project `agentcommons`, owner
`AgentCommonsDev`, repository `agentcommons`, workflow `release-sdks.yml` and
environment `pypi`. It creates the project on the first successful release;
no PyPI token is needed. If the project already exists under your account, add
the same publisher in its settings. A pending publisher does not reserve a name.
See [PyPI's first-release setup](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/).

## Release a version

1. Update `version` in `packages/sdk/package.json` and `packages/sdk-python/pyproject.toml`
   to the same `X.Y.Z`. Run `uv lock --project packages/sdk-python` and `pnpm install`
   to refresh lockfiles. The release workflow currently accepts stable version numbers.
2. Run `pnpm sdk:check`, `pnpm test`, `pnpm test:sdk:python`, and
   `pnpm sdk:release:check sdk-vX.Y.Z`. Merge the version change into `main` after CI passes.
3. From the intended commit on `main`, publish the tag:

   ```bash
   git tag -a sdk-vX.Y.Z -m "SDK X.Y.Z"
   git push origin sdk-vX.Y.Z
   ```

The workflow checks versions and generated output, tests standalone consumers, builds
the npm tarball plus Python wheel and source distribution, and checks Python metadata
with Twine. Separate publishing jobs upload those tested build artifacts. They do not
rebuild packages. Watch both jobs; a successful upload to one registry does not prove
the other succeeded. For a transient failure, rerun only the failed job. Published
versions cannot be replaced; fixes need a new version.

After the first successful release, users can install with:

```bash
npm install @agentcommons/sdk
pip install agentcommons
```

To inspect release artifacts locally without uploading:

```bash
pnpm --filter @agentcommons/sdk pack --out /tmp/agentcommons-sdk.tgz
uv build --project packages/sdk-python
uv run --project packages/sdk-python --locked twine check --strict packages/sdk-python/dist/*
```
