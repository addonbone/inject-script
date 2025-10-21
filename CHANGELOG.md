# Changelog

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
