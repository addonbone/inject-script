# @addon-core/inject-script

[![npm version](https://img.shields.io/npm/v/%40addon-core%2Finject-script.svg?logo=npm&style=for-the-badge)](https://www.npmjs.com/package/@addon-core/inject-script)
[![npm downloads](https://img.shields.io/npm/dm/%40addon-core%2Finject-script.svg?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@addon-core/inject-script)
[![CI](https://img.shields.io/github/actions/workflow/status/addon-stack/inject-script/ci.yml?style=for-the-badge)](https://github.com/addon-stack/inject-script/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE.md)

Run typed functions or inject script files into browser extension tabs with one API for Manifest V2 and Manifest V3.

`@addon-core/inject-script` selects the correct browser adapter, translates explicit frame and document targets, and turns native browser responses into predictable outcomes. You write the callback and choose the target; the package handles the manifest-specific execution path.

- One target model for the top frame, all frames, selected frames, or selected documents
- Typed synchronous and asynchronous callbacks with explicit arguments
- Best-effort batches: one unavailable target does not discard successful results
- Typed `success`/`failure` outcomes with delivery, execution, timeout, target-gone, and unobservable errors
- Strict JSON-compatible data validation with actionable error paths
- No `eval`, no `new Function`, and no extra frame-enumeration permissions

## Install

```bash
npm install @addon-core/inject-script
```

```bash
pnpm add @addon-core/inject-script
```

Your extension still needs the native permissions required for script injection, including `scripting` in MV3 and appropriate host or `activeTab` access. The package does not modify the manifest.

## Quick start

```ts
import injectScript from "@addon-core/inject-script";

const [outcome] = await injectScript({
  target: {tabId: 123},
}).run(() => document.title);

if (outcome.success) {
  console.log(outcome.value);
} else {
  console.error(outcome.error.kind, outcome.error.message);
}
```

The package detects the current manifest version automatically. The same call works through `tabs.executeScript` in MV2 and `scripting.executeScript` in MV3.

## Choose what to target

Every operation has exactly one explicit target. Target selectors are mutually exclusive in TypeScript and validated again at runtime.

| Need | Target |
| --- | --- |
| Main frame | `{tabId: 123}` |
| Every injectable frame | `{tabId: 123, allFrames: true}` |
| One frame | `{tabId: 123, frameIds: [7]}` |
| Selected frames | `{tabId: 123, frameIds: [0, 7, 12]}` |
| Selected documents | `{tabId: 123, documentIds: ["document-a", "document-b"]}` |

```ts
const topFrame = injectScript({
  target: {tabId: 123},
});

const selectedFrames = injectScript({
  target: {tabId: 123, frameIds: [0, 7]},
});

const allFrames = injectScript({
  target: {tabId: 123, allFrames: true},
});
```

`allFrames` accepts only the literal `true`. Omitting a selector means the top frame; there is no `allFrames: false` mode.

For a runtime choice, construct the complete target:

```ts
import type {InjectScriptTarget} from "@addon-core/inject-script";

const target: InjectScriptTarget = includeAllFrames
  ? {tabId: 123, allFrames: true}
  : {tabId: 123};

const injector = injectScript({target});
```

`documentIds` require an MV3 runtime that supports native document targeting. An unsupported selector throws `UnsupportedInjectScriptTargetError`; the package never removes it or silently falls back to the top frame.

### Observed results, not frame discovery

An `allFrames` call is one native browser operation. It returns outcomes for the frames the browser reports as executed; it is not a frame snapshot or an exhaustive RPC fan-out. If the whole native operation fails, the returned failure uses `target: {tabId, allFrames: true}` without inventing a frame ID.

Explicit `frameIds` and `documentIds` are different: `run()` starts one native call per requested target. All calls are initiated before the first result is awaited, which preserves user activation for browser APIs that require a user gesture. The returned array always follows the input order, and a delivery error or timeout for one target does not discard the others.

This isolation has a linear cost: `N` explicit targets create `N` native injection calls. MV2 uses one temporary message listener for the batch and keeps `N` independent timeout timers. The package deliberately starts the native calls without an internal concurrency limit because awaiting a previous chunk could lose user activation. Prefer `allFrames` when one native operation is sufficient; use explicit IDs when independent outcomes are more important.

If an application requires exactly one outcome for every previously discovered frame, enumerate those frames in the application layer and pass that snapshot through explicit `frameIds` targets.

## Run a function

Callbacks may be synchronous or asynchronous:

```ts
const outcomes = await injectScript({
  target: {tabId: 123},
}).run(
  async (url: string) => {
    const response = await fetch(url);

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  },
  ["https://example.com/data"],
);
```

### Keep the callback self-contained

The callback runs in the target page. Runtime variables from the extension module or caller closure are not available there.

```ts
const selector = ".product-title";

// Incorrect: selector is part of the caller closure.
await injector.run(() => {
  return document.querySelector(selector)?.textContent ?? null;
});

// Correct: pass the value explicitly.
await injector.run(
  (targetSelector: string) => {
    return document.querySelector(targetSelector)?.textContent ?? null;
  },
  [selector],
);
```

Type-only annotations are safe because they disappear during compilation. Imported runtime values and closed-over variables are not.

## Work with outcomes

`run()` is best-effort by default. For a valid request, target-level execution, delivery, and timeout errors are values in the resolved array rather than reasons to reject the whole promise:

```ts
type InjectScriptResult<T> =
  | {
      success: true;
      target: InjectScriptResultTarget;
      value: T;
    }
  | {
      success: false;
      target: InjectScriptResultTarget;
      error: InjectScriptTargetError;
    };

type InjectScriptTargetError =
  | {
      kind: "execution" | "delivery" | "target-gone" | "unobservable";
      name: string;
      message: string;
      stack?: string;
    }
  | {
      kind: "timeout";
      name: string;
      message: string;
      stack?: string;
      timeoutMs: number;
      missingCount?: number;
    };

type InjectScriptResultTarget =
  | {tabId: number; frameId: number; documentId?: string}
  | {tabId: number; documentId: string; frameId?: number}
  | {tabId: number; allFrames: true};
```

- `success: true` contains the JSON-compatible callback value.
- `success: false` contains the affected target and a normalized error.
- A document delivery failure can be identified by `documentId` alone; the package never adds a fake `frameId`.

Explicit-target results follow the requested `frameIds` or `documentIds` order. Successful `allFrames` results are sorted by `frameId`, with the main frame (`frameId: 0`) first, and preserve `documentId` when available.

A failed target does not discard successful results from other targets:

```ts
for (const outcome of outcomes) {
  if (outcome.success) {
    useValue(outcome.target, outcome.value);
  } else {
    reportTargetError(outcome.target, outcome.error);
  }
}
```

Error kinds are stable and exported as `InjectScriptTargetErrorKind`:

| Kind | Meaning |
| --- | --- |
| `Execution` (`"execution"`) | The callback ran but failed, or its result violated the data contract |
| `Delivery` (`"delivery"`) | The browser could not deliver or observe the injection |
| `Timeout` (`"timeout"`) | This target, or an `allFrames` operation, did not finish in time |
| `TargetGone` (`"target-gone"`) | The browser reported that the requested tab, frame, or document disappeared |
| `Unobservable` (`"unobservable"`) | The browser exposed neither a usable callback result nor an observable callback error |

`InjectScriptTargetErrorKind` is a string enum. Its template-literal form can be used when an application needs to assign literal strings:

```ts
const retryKinds: `${InjectScriptTargetErrorKind}`[] = ["timeout", "target-gone"];

if (!outcome.success && outcome.error.kind === InjectScriptTargetErrorKind.Timeout) {
  // ...
}
```

A timeout failure always includes `timeoutMs`. For an MV2 `allFrames` timeout, `missingCount` reports how many injected frames did not answer. Partial per-frame outcomes remain ordinary sibling elements in the returned result array instead of being duplicated inside the timeout error.

## Return application-level errors as data

Package outcomes describe injection and frame execution. If your callback is acting like an RPC method and needs a guaranteed business-level result, return an explicit JSON-compatible envelope:

```ts
type RemoteResult<T> =
  | {ok: true; valuePresent: true; value: T}
  | {ok: true; valuePresent: false}
  | {ok: false; error: {name: string; message: string; stack?: string}};

const outcomes = await injector.run(
  (selector: string): RemoteResult<string> => {
    try {
      const element = document.querySelector(selector);

      if (!element) {
        return {ok: true, valuePresent: false};
      }

      return {
        ok: true,
        valuePresent: true,
        value: element.textContent ?? "",
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack ? {stack: error.stack} : {}),
        },
      };
    }
  },
  [".product-title"],
);
```

This produces two intentionally separate levels:

```text
InjectScriptResult.success  -> Did injection and callback execution succeed?
RemoteResult.ok             -> Did the application operation succeed?
```

## Pass and return plain data

Arguments and callback results must be JSON-compatible:

- `null`, booleans, finite numbers, and strings
- dense plain arrays containing supported values
- plain objects with string keys and supported values

```ts
await injector.run(() => ({
  id: 123,
  title: document.title,
  price: null,
  tags: ["sale", "featured"],
}));
```

The following values are not supported:

```ts
undefined;
Number.NaN;
Infinity;
123n;
new Date();
new Map();
document.body;
classInstance;
circularObject;
```

Arrays must not contain holes, custom enumerable properties, or use an `Array` subclass. Plain arrays and objects must not have enumerable symbol-keyed properties. Omit an optional property instead of assigning `undefined`, or use `null` when the absence is meaningful.

TypeScript catches most incompatible values through `JsonCompatible<T>`. Runtime validation covers the remaining cases and reports the exact path and reason before injection when possible:

```text
Invalid InjectScript arguments: arguments[0].limit is undefined; JSON has no undefined value. Omit the key or use null.

Injected function result is not JSON-compatible: result is a Date instance; pass a plain object.
```

MV2 validates the result inside the injected payload. MV3 validates the native result returned by the browser. Chrome may serialize or convert a value before returning it, so the package cannot reconstruct information already lost at the native boundary.

## Inject script files

```ts
await injector.file("scripts/content.js");

await injector.file([
  "scripts/vendor.js",
  "scripts/content.js",
]);
```

Files are injected in the provided order. `file()` uses the same target and execution options as `run()`, rejects an empty list, and returns `Promise<void>` because browser APIs do not provide a portable per-frame result contract for files.

## Reuse an injector

Replace the complete target with `target()`:

```ts
injector
  .target({tabId: 123, frameIds: [7]})
  .target({tabId: 123, allFrames: true});
```

The second call replaces the previous selector instead of merging with it. A validation failure leaves the existing target unchanged.

Update only execution options with `options()`:

```ts
injector.options({
  timeoutMs: 8_000,
  world: "ISOLATED",
});
```

`options()` never accepts or changes a target.

## Execution options

The portable baseline is simple:

```ts
const injector = injectScript({
  target: {tabId: 123},
  timeoutMs: 5_000,
  runAt: "document_idle",
  world: "ISOLATED",
});
```

| Option | MV2 | MV3 |
| --- | --- | --- |
| `timeoutMs` | Supported; default `4_000` ms | Supported; default `4_000` ms |
| `matchAboutBlank` | Supported; native default `false` | Rejected; no equivalent native option |
| `runAt: "document_start"` | Passed to `tabs.executeScript` | Mapped to `injectImmediately: true` |
| `runAt: "document_idle"` or omitted | Native scheduling | Native scheduling |
| `runAt: "document_end"` | Passed to `tabs.executeScript` | Rejected; cannot be represented |
| `world: "ISOLATED"` | Accepted as native MV2 behavior | Passed to `scripting.executeScript` |
| `world: "MAIN"` | Rejected | Passed to `scripting.executeScript` |

Explicit unsupported options throw `UnsupportedInjectScriptOptionError`. They are never ignored or removed silently.

When an application intentionally needs adapter-specific behavior, branch before creating the injector:

```ts
import {isManifestVersion3} from "@addon-core/browser";

const injector = isManifestVersion3()
  ? injectScript({
      target: {tabId: 123},
      world: "MAIN",
      runAt: "document_start",
    })
  : injectScript({
      target: {tabId: 123},
      matchAboutBlank: true,
      runAt: "document_end",
    });
```

## Handle failures

Target-level failures from `run()` belong in the resolved outcome array:

```ts
import {InjectScriptTargetErrorKind} from "@addon-core/inject-script";

const outcomes = await injectScript({
  target: {tabId: 123, frameIds: [7, 2, 9]},
  timeoutMs: 5_000,
}).run(() => location.href);

for (const outcome of outcomes) {
  if (outcome.success) {
    console.log(outcome.target, outcome.value);
    continue;
  }

  if (outcome.error.kind === InjectScriptTargetErrorKind.TargetGone) {
    console.warn("Target disappeared", outcome.target);
  } else {
    console.error(outcome.target, outcome.error);
  }
}
```

`run()` can still reject when the request itself is invalid or unsupported, for example because arguments are not JSON-compatible or MV2 receives `documentIds`. These are preparation or capability errors, not failures of one requested target.

Known adapter limitations are rejected before injection. A browser-specific capability error discovered only from the native MV3 call is different: all explicit calls have already been started to preserve user activation, so callbacks may have completed in some targets before `run()` rejects. For callbacks with side effects, do not interpret such a rejection as proof that nothing executed.

`file()` remains a strict `Promise<void>` operation because native browser APIs do not expose a portable per-target file result. Its delivery and timeout failures reject:

```ts
import {InjectScriptBaseError} from "@addon-core/inject-script";

try {
  await injector.file("scripts/content.js");
} catch (error) {
  if (error instanceof InjectScriptBaseError) {
    console.error(error.code, error.message, error.cause);
  } else {
    throw error;
  }
}
```

Every package error extends `InjectScriptBaseError` and exposes a stable `code`. Prefer `code` when errors may cross realms or multiple copies of the dependency may exist; `instanceof` is convenient within one package instance.

### Cross-browser outcome details

- Firefox can expose a literal `throw undefined` as an existing `error` property whose value is `undefined`. The package preserves it as an `Execution` failure.
- A defined `result` takes precedence over an `error: undefined` placeholder.
- MV2 can identify an unsupported callback result of `undefined` and returns an `Execution` failure with `TypeError`.
- If MV3 exposes neither a usable `result` nor an observable error, the package returns an `Unobservable` failure. Chrome MV3 does not always expose the exact callback exception, so exact automatic exception serialization cannot be guaranteed there.
- For top-frame and explicit-target calls, a target that does not answer before `timeoutMs` returns a `Timeout` failure for that target.
- For MV2 `allFrames`, a missing response cannot be assigned to a frame without another permission-dependent API. The result keeps every observed per-frame outcome and adds one `Timeout` failure with `target: {tabId, allFrames: true}`.

Return `null` or an explicit application envelope when the caller must distinguish a successful no-value result from an unavailable native outcome.

## API reference

The reference stays compact on purpose: most applications need one factory and four methods.

### Factory

```ts
injectScript(options: InjectScriptOptions): InjectScriptContract;
```

The factory is available as both a default and named export:

```ts
import injectScript from "@addon-core/inject-script";
import {injectScript} from "@addon-core/inject-script";
```

### Methods

Simplified signatures are shown below. The published TypeScript declarations additionally enforce JSON-compatible callback arguments and results.

```ts
interface InjectScriptContract {
  run<Args extends readonly unknown[], Result>(
    func: (...args: Args) => Result,
    args?: Args,
  ): Promise<InjectScriptResult<Awaited<Result>>[]>;

  file(files: string | NonEmptyReadonlyArray<string>): Promise<void>;
  target(target: InjectScriptTarget): this;
  options(options: Partial<InjectScriptExecutionOptions>): this;
}
```

### Options

```ts
interface InjectScriptOptions {
  target: InjectScriptTarget;
  matchAboutBlank?: boolean;
  runAt?: "document_start" | "document_end" | "document_idle";
  timeoutMs?: number;
  world?: "ISOLATED" | "MAIN";
}
```

### Runtime exports

```ts
injectScript
InjectScriptTargetErrorKind
InjectScriptBaseError
InjectScriptDeliveryError
InjectScriptTimeoutError
InvalidInjectScriptArgumentsError
InvalidInjectScriptFilesError
InvalidInjectScriptOptionsError
InvalidInjectScriptTargetError
UnsupportedInjectScriptOptionError
UnsupportedInjectScriptTargetError
```

### Type exports

Core types:

```ts
InjectScriptContract
InjectScriptOptions
InjectScriptExecutionOptions
InjectScriptTarget
InjectScriptResult
InjectScriptResultTarget
InjectScriptTargetError
InjectScriptTargetFailure
InjectScriptTargetSuccess
InjectScriptTargetTimeoutError
SerializedInjectScriptError
InjectScriptErrorCode
```

Advanced target and JSON types:

```ts
InjectScriptTopFrameTarget
InjectScriptAllFramesTarget
InjectScriptFramesTarget
InjectScriptDocumentsTarget
InjectScriptFunctionResult
JsonCompatible
JsonPrimitive
JsonValue
NonEmptyReadonlyArray
```

## Design boundaries

The package deliberately stays focused on portable script injection. It does not enumerate frames, create address snapshots, run per-frame concurrency queues, or provide application-specific all-settled aggregation. Those behaviors belong in the caller that understands the application protocol.

The runtime never uses `eval` or `new Function`. MV3 passes the callback directly to `scripting.executeScript`; MV2 embeds the callback source in the code accepted by `tabs.executeScript`.

## License

[MIT](LICENSE.md)
