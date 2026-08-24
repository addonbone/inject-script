type RunAt = chrome.extensionTypes.RunAt;
type ExecutionWorld = chrome.scripting.ExecutionWorld;

export type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
    | JsonPrimitive
    | readonly JsonValue[]
    | {
          readonly [key: string]: JsonValue;
      };

export type JsonCompatible<T> = T extends JsonValue
    ? T
    : T extends (...args: any[]) => unknown
      ? never
      : T extends readonly unknown[]
        ? {[K in keyof T]: JsonCompatible<T[K]>}
        : T extends object
          ? {[K in keyof T]: JsonCompatible<T[K]>}
          : never;

export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export interface InjectScriptTopFrameTarget {
    tabId: number;
    allFrames?: never;
    frameIds?: never;
    documentIds?: never;
}

export interface InjectScriptAllFramesTarget {
    tabId: number;
    allFrames: true;
    frameIds?: never;
    documentIds?: never;
}

export interface InjectScriptFramesTarget {
    tabId: number;
    frameIds: NonEmptyReadonlyArray<number>;
    allFrames?: never;
    documentIds?: never;
}

export interface InjectScriptDocumentsTarget {
    tabId: number;
    documentIds: NonEmptyReadonlyArray<string>;
    allFrames?: never;
    frameIds?: never;
}

export type InjectScriptTarget =
    | InjectScriptTopFrameTarget
    | InjectScriptAllFramesTarget
    | InjectScriptFramesTarget
    | InjectScriptDocumentsTarget;

export interface InjectScriptExecutionOptions {
    matchAboutBlank?: boolean;
    runAt?: RunAt;
    timeoutMs?: number;
    world?: ExecutionWorld | `${ExecutionWorld}`;
}

export interface InjectScriptOptions extends InjectScriptExecutionOptions {
    target: InjectScriptTarget;
}

export interface InjectScriptResultTarget {
    tabId: number;
    frameId: number;
    documentId?: string;
}

export interface SerializedInjectScriptError {
    name: string;
    message: string;
    stack?: string;
}

export type InjectScriptResult<T> =
    | {
          target: InjectScriptResultTarget;
          status: "fulfilled";
          result: T;
      }
    | {
          target: InjectScriptResultTarget;
          status: "rejected";
          error: SerializedInjectScriptError;
      }
    | {
          target: InjectScriptResultTarget;
          status: "unknown";
      };

export type InjectScriptFunctionResult<T = JsonValue> = T | PromiseLike<T>;

type JsonCompatibleReturn<R> = [Awaited<R>] extends [never]
    ? unknown
    : Awaited<R> extends JsonCompatible<Awaited<R>>
      ? unknown
      : never;

export interface InjectScriptContract {
    run<R>(func: (() => R) & JsonCompatibleReturn<R>, args?: readonly []): Promise<InjectScriptResult<Awaited<R>>[]>;

    run<A extends NonEmptyReadonlyArray<unknown>, R>(
        func: ((...args: A) => R) & JsonCompatibleReturn<R>,
        args: A & JsonCompatible<A>
    ): Promise<InjectScriptResult<Awaited<R>>[]>;

    file(files: string | NonEmptyReadonlyArray<string>): Promise<void>;

    target(target: InjectScriptTarget): this;

    options(options: Partial<InjectScriptExecutionOptions>): this;
}
