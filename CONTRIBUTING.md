# Contributing to @addon-core/inject-script

Thank you for helping improve `@addon-core/inject-script`.

This package provides one typed script-injection contract across Manifest V2 and Manifest V3. Contributions should preserve that cross-manifest boundary, keep unsupported capabilities explicit, and include verification for every affected adapter.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through the private process described in [SECURITY.md](SECURITY.md), not through a public issue.

## Development workflow

The repository uses a simplified GitFlow model:

- `main` contains released code.
- `develop` is the integration branch and the normal pull-request target.
- `feature/<short-name>` branches start from `develop`.
- Releases are prepared by merging `develop` into `main`.
- After a successful release, the workflow syncs `main` back into `develop`.

Create a branch from the latest `develop`:

```bash
git switch develop
git pull --ff-only
git switch -c feature/<short-name>
```

## Local setup

Node.js 20 is the default CI environment. The full release gate also exercises Node.js 18, 20, and 22.

```bash
git clone git@github.com:addon-stack/inject-script.git
cd inject-script
npm ci
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build continuously with tsup |
| `npm run build` | Create ESM, CJS, and declaration outputs |
| `npm run format` | Format supported files with Biome |
| `npm run format:check` | Check formatting without writing |
| `npm run lint` | Run Biome formatting and lint checks |
| `npm run lint:fix` | Apply safe Biome fixes |
| `npm run lint:fix:unsafe` | Apply safe and unsafe Biome fixes |
| `npm run typecheck` | Type-check package sources |
| `npm run test:types` | Type-check public API contract fixtures |
| `npm run test` | Build and run the Jest suite |
| `npm run test:ci` | Build and run Jest with coverage |
| `npm run release` | Perform a real maintainer release through release-it |

`npm run release` is not a dry run. Do not execute it unless you are intentionally publishing a release and have the required maintainer access.

## Contribution guidelines

Keep changes focused and preserve the package's public design:

- Every operation has one explicit `target`.
- Target selectors remain mutually exclusive.
- Unsupported targets and options fail explicitly; they are never removed silently.
- `run()` returns package-owned per-frame outcomes instead of raw browser results.
- Callback arguments and results remain strictly JSON-compatible.
- MV2 injected code must stay self-contained because imports and caller closures do not cross the injection boundary.
- Runtime code must not introduce `eval` or `new Function`.
- Frame discovery, RPC fan-out, concurrency queues, and application-specific aggregation remain outside this package.

When changing public behavior, update the implementation, types, tests, and README together.

## Tests

The test suite covers three different contracts:

- `tests/types.test.ts` verifies compile-time API behavior.
- `tests/inject-script.test.cjs` verifies MV2/MV3 runtime behavior against the built package.
- `tests/release-it.test.cjs` verifies release versioning policy.

For adapter changes, cover the affected combinations where relevant:

- Manifest V2 and Manifest V3;
- callback-based `global.chrome` and Promise-based `global.browser`;
- top frame, `allFrames`, explicit `frameIds`, and `documentIds`;
- `fulfilled`, `rejected`, and `unknown` outcomes;
- valid JSON data and runtime-only invalid values;
- preparation errors, native delivery failures, and timeouts.

MV2 payload tests execute the generated code in a separate process. Keep this path covered when changing serialized injected logic.

## Quality gates

Before opening a pull request, run:

```bash
npm run lint
npm run typecheck
npm run test:ci
```

`test:ci` already runs type-contract tests and a production build before Jest.

Local hooks provide additional protection:

- `pre-commit` runs `lint-staged`, which formats and lints supported staged source/config files.
- `commit-msg` validates Conventional Commits with commitlint.
- `pre-push` runs `typecheck` and the full `test:ci` command.

GitHub Actions repeats lint, typecheck, tests, coverage, and production build checks. Release runs use the full operating-system and Node.js matrix.

## Commit messages

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(optional scope): <short summary>

[optional body]
[optional footer]
```

Common examples:

```text
feat(target): add document targeting
fix(mv2): preserve partial timeout results
refactor(results): centralize native normalization
test(types): cover interface arguments
docs: simplify the quick start
```

Use `!` or a `BREAKING CHANGE:` footer for an incompatible public change:

```text
feat!: replace the legacy target options
```

Commit messages are enforced by `.husky/commit-msg` and `.commitlintrc.json`.

## Versioning policy

Release versions are derived from commit history by `release-it` and `@release-it/conventional-changelog`:

- A breaking change increments major at `1.x` and newer.
- A breaking change increments minor while the package is on `0.x`.
- `feat` and `revert` increment minor.
- `fix`, `perf`, `refactor`, and `ci` increment patch.
- `docs`, `test`, `build`, `chore`, and `style` do not trigger a release by themselves.
- When several changes are present, the highest applicable increment wins.

Do not edit released changelog entries manually. `CHANGELOG.md` is generated from Conventional Commits during release.

## Pull requests

Open regular pull requests against `develop` and include:

- a concise explanation of the problem and the chosen solution;
- tests for changed behavior;
- documentation for public API or contract changes;
- migration notes for breaking changes;
- links to related issues when available.

Pull-request checklist:

- [ ] The change is focused and contains no unrelated edits.
- [ ] MV2 and MV3 implications have been considered.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test:ci` passes.
- [ ] Public documentation is updated when necessary.
- [ ] Commit messages follow Conventional Commits.

Maintainers create release pull requests from `develop` into `main`.

## Releases

The release workflow runs on pushes to `main` and through manual dispatch:

1. Run the full CI matrix.
2. Calculate the next version from Conventional Commits unless an exact version was provided.
3. Update `package.json` and `CHANGELOG.md`.
4. Create the release commit and Git tag.
5. Create a GitHub Release.
6. Publish the public npm package with provenance through trusted publishing.
7. Sync `main` back into `develop`.

The workflow accepts optional prerelease and npm dist-tag inputs. It uses GitHub OIDC permissions for npm provenance and does not depend on a documented contributor `NPM_TOKEN` flow.

Publishing is a maintainer operation. Contributors only need to prepare a complete, verified pull request into `develop`.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE.md).
