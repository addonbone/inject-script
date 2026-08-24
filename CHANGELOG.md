# Changelog

## 🚀 Release `@addon-core/inject-script` v0.4.0 (2026-08-24)

### 💥 Breaking Changes

* replace flat tabId/frameId/documentId options with a
required nested target. Rename timeFallback to timeoutMs and make run()
resolve to InjectScriptResult<T>[]. options() now accepts execution options
only. Callback arguments and results must be JSON-compatible, unsupported
capabilities throw typed package errors, and file arrays must be non-empty.


### ✨ Features

* redesign the cross-manifest injection contract ([938cf0d](https://github.com/addon-stack/inject-script/commit/938cf0d732979501dfa9116e11d155744f54395a))

  - require one explicit and mutually exclusive target
  - normalize MV2 and MV3 execution into per-frame outcomes
  - enforce JSON-compatible callback arguments and results
  - expose typed delivery, validation, and timeout errors
  - add runtime and compile-time contract coverage
  - update @addon-core/browser and remove nanoid



### 🐛 Bug Fixed

* **release:** update `.release-it.cjs` with public access and registry URL ([34d7ddc](https://github.com/addon-stack/inject-script/commit/34d7ddc3a43b070476adcce2a30df1c59f5c2561))




### 📝 Documentation

* refresh contribution and security guidance ([9fe5645](https://github.com/addon-stack/inject-script/commit/9fe56457f8d4a949bcf5ee79e58240868f6e214f))


* rewrite package documentation for the new API ([4280e5c](https://github.com/addon-stack/inject-script/commit/4280e5ce66673dde4c66a4f26bc2c5a547a9f74a))




### 🤖 CI

* **release:** keep breaking releases minor before 1.0 ([750096c](https://github.com/addon-stack/inject-script/commit/750096c49b6b246e63a75690f10c96bdca0efc3f))


* **release:** update workflows, package config, and .gitignore for npm improvements ([010304d](https://github.com/addon-stack/inject-script/commit/010304d8f505f9128f7f1c2d5764e678d1542362))




### 🧹 Chores

* **tooling:** align local quality gates with CI ([cca919f](https://github.com/addon-stack/inject-script/commit/cca919f5b50bf8bbd0b4ab4d020c1acdc193af7f))


* update configurations and scripts for consistency and accuracy ([fd3f230](https://github.com/addon-stack/inject-script/commit/fd3f2307b28f3c8b43567c4ad4ead3409e326060))

  - Remove `.prettierignore` as Biome replaces Prettier for linting and formatting.
  - Update `.mailmap` with enhanced contributor tracking fields.
  - Add emoji to `test` in `.release-it.cjs` configuration for consistency.
  - Modify `test` script in `package.json` to include `--bail` and handle no tests gracefully.
  - Remove unused `test:related` script from `package.json`.




### 🙌 Contributors

- [Anjey Tsibylskij](https://github.com/atldays) (@atldays) — 8 commits
- [Addon Bone](addonbonedev@gmail.com) — 1 commits

## 🚀 Release `@addon-core/inject-script` v0.3.1 (2025-10-21)


### 🐛 Bug Fixed

* handle exceptions when checking for Firefox compatibility ([4a1c250](https://github.com/addon-stack/inject-script/commit/4a1c250bfcebb330efd8a8214390dbee11ce713f))





### 🙌 Contributors

- [Addon Stack](addonbonedev@gmail.com) — 2 commits
- [Rostyslav Nihrutsa](rostyslav.nihrutsa@gmail.com) — 1 commits

## 🚀 Release `@addon-core/inject-script` v0.3.0 (2025-10-08)


### ✨ Features

* update dependencies and package metadata ([413b15e](https://github.com/addon-stack/inject-script/commit/413b15eec9fb2e72f4d226ecd39388d488806c97))

  - Rename `@adnbn` scope to `@addon-core`
  - Add new dev dependencies including Jest, CommitLint, ReleaseIt, and others



### 📝 Documentation

* update README and documentation files for rebranding and improved clarity ([481e1a1](https://github.com/addon-stack/inject-script/commit/481e1a1c286da14ae480e9408f4e9cd0a82fa877))

  - Update scope from `@adnbn` to `@addon-core` across entire README and docs.
  - Add badges for license, CI/CD status, and npm stats to README.
  - Expand usage examples with clear MV2/MV3 distinctions and advanced scenarios.
  - Introduce sections for features, compatibility, and troubleshooting.
  - Revise CONTRIBUTING.md with a detailed branching model, workflow, and quality gates.
  - Add SECURITY.md with vulnerability reporting guidelines and support policy.
  - Include MIT License file with detailed permissions and conditions.



### 🤖 CI

* set up robust CI/CD pipelines and automated releases ([756401e](https://github.com/addon-stack/inject-script/commit/756401e0faf950ab6e0c3bdb214399efd15c2583))

  - Add CI workflow for linting, testing, and coverage reporting using GitHub Actions.
  - Introduce matrix builds for OS (Ubuntu, Windows) and Node.js versions (18, 20, 22).
  - Create a release workflow for version bumping, publishing, and main-to-develop sync.
  - Configure release-it for automated changelog generation and semantic releases.
  - Improve contributor tracking with custom `.mailmap` and release-it configuration.



### 🧹 Chores

* configure project with Husky, CommitLint, and Biome ([b4234ba](https://github.com/addon-stack/inject-script/commit/b4234ba9c5d294d022307f3e178309f44c0947a4))

  - Add Husky hooks for pre-commit, commit-msg, and pre-push validations.
  - Introduce CommitLint with conventional commit style configuration.
  - Replace Prettier with Biome for formatting and linting, with detailed configuration.
  - Enforce consistent line endings using `.gitattributes`.

* update dependencies and adjust configurations ([7251e7e](https://github.com/addon-stack/inject-script/commit/7251e7ec795dfcf0f60d8f889eecb61ce03192ba))

  - Expand `ExecutionWorld` type to accept string literals for flexibility.
  - Simplify `release` script by removing unused `release:preview` from `package.json`.
  - Add overrides for `glob` and `source-map` packages, ensuring compatibility.
  - Bump esbuild-related dependencies to version 0.25.10 for enhanced features and fixes.



### 🛠️ Refactoring

* add robust message handling for `InjectScriptV2` ([246fdeb](https://github.com/addon-stack/inject-script/commit/246fdebec98854f8deac43702815237c4f34674f))

  - Introduce `getBrowser` utility to determine runtime environment (Chrome/Firefox API).
  - Add `sendMessage` helper function for safe and consistent message dispatching.
  - Replace direct `chrome.runtime.sendMessage` calls with `sendMessage` for error resilience.
  - Improve error handling with detailed console logs for runtime and unexpected exceptions.

* improve target resolution and script execution handling ([1e488e5](https://github.com/addon-stack/inject-script/commit/1e488e5b2514452e6d3d5b00cc80bec01d722da2))

  - Simplify `target()` method logic in `InjectScriptV3` for clarity and edge case handling.
  - Refactor `run()` method across `InjectScriptV2` and `InjectScriptV3` for streamlined execution.
  - Adjust imports to use standard and renamed modules from `@addon-core/browser`.
  - Add more robust error-handling in `InjectScriptV2` execution flow.
  - Use TS `type` imports to improve code clarity and type inference.

* simplify `run` method type definition in `InjectScriptContract` ([bcce7fd](https://github.com/addon-stack/inject-script/commit/bcce7fdcffcb0780fba4ace5e58c3a3136176339))

  - Remove redundant type constraint on `R` in `run` method to streamline type definition.
  - Ensure easier maintenance and improved type inference consistency.

* split `tsup` config for ESM and CJS builds ([ccd9725](https://github.com/addon-stack/inject-script/commit/ccd9725049447a2b55d1eb516c174126151ada5a))

  - Extract shared options into a `common` configuration object.
  - Separate ESM and CJS configurations for better customization and clarity.
  - Adjust `dts` and `clean` options for respective build formats.




### 🙌 Contributors

- [Addon Bone](addonbonedev@gmail.com) — 12 commits
