# SDK releases

Public packages: `@papers.bot/sdk` on npm and `papers-bot` on PyPI. Python imports
remain `from papers import Papers`. The private `papers-bot` npm workspace is
only a task/version wrapper; it is never published to npm.

## Everyday workflow

1. Run `pnpm changeset` with an SDK change. Select the affected SDK(s), choose
   patch/minor/major, and describe the user-visible change. Commit the generated
   Markdown file with the implementation.
2. Merge the feature PR into `main` after the required `verify` check passes.
3. Changesets opens or updates **Release Papers SDKs**. This PR contains version
   bumps, changelogs, synchronized Python metadata, and refreshed lockfiles.
4. Merge the release PR when ready. The release workflow validates and builds
   both SDKs, then publishes the verified artifacts in independent npm and PyPI
   jobs. Each successful package gets a Git tag and GitHub release with its
   changelog entry, for example `@papers.bot/sdk@0.1.1` and `papers-bot@0.1.1`.

Versions are independent. Both SDKs need not be released together. Only stable
x.y.z versions are supported by the Python bridge. GitHub explicitly dispatches
CI on the bot-created release PR because commits created with `GITHUB_TOKEN`
do not otherwise trigger PR workflows.

Retry failed publishing jobs from GitHub Actions, or manually run **Release
SDKs** on `main`. Existing npm versions and PyPI files are skipped; incomplete
PyPI uploads resume. GitHub releases are also idempotent. Pending changesets
prevent publication until their release PR is merged.

## Trusted publishing configuration

Both publishing jobs use GitHub OIDC; neither reads npm or PyPI token secrets.
Configure these exact trusted publisher identities in the respective registry:

| Field              | npm           | PyPI          |
| ------------------ | ------------- | ------------- |
| Owner              | `gmpetrov`    | `gmpetrov`    |
| Repository         | `papers`      | `papers`      |
| Workflow filename  | `release.yml` | `release.yml` |
| GitHub environment | `npm`         | `pypi`        |

The GitHub environments accept only the `main` branch. Enable Actions to create
pull requests, and require `verify` on PRs into `main`. The version job can write
PRs and dispatch CI; only publishing jobs receive `id-token: write`.

For the first npm upload only, manually run **Bootstrap npm SDK** on `main`.
It validates the packages and uses the repository `NPM_TOKEN` secret. The token
must allow publishing in `@papers.bot` and bypass 2FA. Subsequent releases use
OIDC exclusively.

npm trusted publishing requires the package to exist first and uses npm 11 in
CI. The npm tarball is created with `pnpm pack` so `publishConfig.exports` points
to compiled files, then uploaded using npm's OIDC-aware CLI with provenance.
PyPI uses `uv publish --trusted-publishing always`. Registry setup is required
before new versions can publish successfully. A local token is only needed for
manual publishing or npm bootstrap. After OIDC is verified, old publishing tokens
can be revoked and their unused GitHub secrets removed.

## Local commands

- `pnpm changeset`: record a future release.
- `pnpm version-packages`: consume changesets and update both ecosystems' metadata.
- `pnpm release:check`: type checks, SDK/CLI and Python tests, builds, release-tool
  tests, and installed-package smoke checks. Does not publish.
- `pnpm publish:npm` / `pnpm publish:python`: validate and publish one SDK locally.

For local Python publishing with the git-ignored credentials file:

```sh
export PATH="$PWD/.venv/bin:$PATH"
pnpm exec dotenv -e .env.publish -- pnpm publish:python
```

Routine releases should use the GitHub release PR instead of editing versions
by hand. Automatic local commits are disabled so Python's metadata and lockfile
can be included in the same release commit by the Changesets action.
