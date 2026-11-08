# Publishing the SDKs

The [SDK release workflow](../.github/workflows/release-sdks.yml) publishes
`@agentcommons/sdk` to npm and `agentcommons` to PyPI when a maintainer pushes an
`sdk-vX.Y.Z` tag. The tag must point to a commit on `main`, and both package versions
must match it. Merging a PR does not publish packages.

## First-time setup

You need permission to manage this repository's GitHub environments and accounts on
[npm](https://www.npmjs.com/signup) and [PyPI](https://pypi.org/account/register/).
Complete each site's email verification and two-factor authentication setup. The
workflow creates the package listings on the first successful upload.

### 1. Create the GitHub environments

Open [Settings → Environments](https://github.com/AgentCommonsDev/agentcommons/settings/environments).
Click **New environment**, enter `npm`, and click **Configure environment**. Repeat
for `pypi`. These names must match the release workflow and registry forms below.
If you restrict deployment branches and tags, allow tags matching `sdk-v*`.

### 2. Set up the npm organization and first-release token

The package name `@agentcommons/sdk` belongs to the npm scope `@agentcommons`.
The GitHub organization does not create that npm scope for you.

1. Sign in to npm. Open your profile menu → **Add an Organization**. Enter
   `agentcommons`, choose the free **Unlimited public packages** plan, and create it.
   If your team already owns it, use an account with publishing access. If someone
   else owns the scope, choose a scope you control and update the SDK package name,
   release guard and documentation before publishing.
2. Open your profile menu → **Access Tokens** → **Generate New Token**. Configure:

   | Setting                          | Value                                                         |
   | -------------------------------- | ------------------------------------------------------------- |
   | Token name                       | `agentcommons-first-release`                                  |
   | Packages and scopes permission   | Read and write (publish and stage)                            |
   | Selected scope                   | `@agentcommons`                                               |
   | Bypass two-factor authentication | Enabled, so GitHub Actions can publish unattended             |
   | Organizations permission         | No access; package publishing uses the scope permission above |
   | Expiration                       | A short period that covers the first release                  |

3. Generate the token and copy it. In GitHub's `npm` environment, under
   **Environment secrets**, click **Add environment secret**. Name it `NPM_TOKEN`,
   paste the token as its value, and save.

The first tag uses this token to create `@agentcommons/sdk`. After that release,
replace it with the trusted publisher in step 5.
See npm's [organization setup](https://docs.npmjs.com/creating-an-organization/) and
[token settings](https://docs.npmjs.com/creating-and-viewing-access-tokens/).

### 3. Set up PyPI's pending publisher

Sign in to PyPI and open [Your account → Publishing](https://pypi.org/manage/account/publishing/).
Under **Add a new pending publisher**, select **GitHub** and enter:

| Field             | Value              |
| ----------------- | ------------------ |
| PyPI project name | `agentcommons`     |
| Owner             | `AgentCommonsDev`  |
| Repository name   | `agentcommons`     |
| Workflow name     | `release-sdks.yml` |
| Environment name  | `pypi`             |

Click **Add**. Enter only the workflow filename, including `.yml`.
No PyPI API token or GitHub secret is needed. The first successful upload creates
the project and makes this publisher permanent. A pending publisher does not
reserve the package name. If you already own the project, add the same publisher
under that project's **Publishing** settings instead.
See [PyPI's first-release setup](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/).

### 4. Publish version 0.1.0

Once both registries are configured and CI is green on `main`, run these commands
from the repository with Node.js 24, pnpm 10 and [uv](https://docs.astral.sh/uv/) installed:

```bash
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
uv sync --project packages/sdk-python --locked
pnpm sdk:release:check sdk-v0.1.0
git tag -a sdk-v0.1.0 -m "SDK 0.1.0"
git push origin sdk-v0.1.0
```

The final command starts publication. Open
[Actions → SDK release](https://github.com/AgentCommonsDev/agentcommons/actions/workflows/release-sdks.yml)
and wait for `build`, `npm` and `pypi` to succeed. If a registry job fails, fix its
settings and use **Re-run failed jobs** for that run. Keep the original tag; a
registry that already accepted the version will reject a second upload.

Confirm the versions on [npm](https://www.npmjs.com/package/@agentcommons/sdk) and
[PyPI](https://pypi.org/project/agentcommons/), then install them in your project:

```bash
npm install @agentcommons/sdk
pip install agentcommons
```

Update the main and SDK READMEs' first-release installation notes once both packages
are available.

### 5. Switch npm to trusted publishing

Open `@agentcommons/sdk` on npm → **Settings** → **Trusted Publisher**. Select
**GitHub Actions**, then enter:

| Field                | Value                       |
| -------------------- | --------------------------- |
| Organization or user | `AgentCommonsDev`           |
| Repository           | `agentcommons`              |
| Workflow filename    | `release-sdks.yml`          |
| Environment name     | `npm`                       |
| Allowed actions      | Enable direct `npm publish` |

Save the publisher. Delete `NPM_TOKEN` from GitHub's `npm` environment and revoke
`agentcommons-first-release` in npm's **Access Tokens** page. Later releases use
GitHub's OIDC identity and include provenance. PyPI already uses this mechanism.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Later releases

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

## Inspect artifacts without publishing

To build the same distribution formats locally:

```bash
pnpm --filter @agentcommons/sdk pack --out /tmp/agentcommons-sdk.tgz
uv build --project packages/sdk-python
uv run --project packages/sdk-python --locked twine check --strict packages/sdk-python/dist/*
```
