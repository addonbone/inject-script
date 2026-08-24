import {executeScript} from "@addon-core/browser";
import AbstractInjectScript from "./AbstractInjectScript";
import {UnsupportedInjectScriptOptionError, UnsupportedInjectScriptTargetError} from "./errors";
import {normalizeNativeInjectionResult, sortInjectionResults} from "./results";
import type {
    InjectScriptExecutionOptions,
    InjectScriptOptions,
    InjectScriptResult,
    InjectScriptTarget,
    JsonValue,
    NonEmptyReadonlyArray,
} from "./types";

type InjectionTarget = chrome.scripting.InjectionTarget;

export default class extends AbstractInjectScript {
    public constructor(options: InjectScriptOptions) {
        super(options);
        this.assertAdapterSupport(this._target, this._execution);
    }

    public async run<A extends readonly unknown[], R>(
        func: (...args: A) => R,
        args?: A
    ): Promise<InjectScriptResult<Awaited<R>>[]> {
        this.validateArguments(args);

        const target = this.snapshotTarget();
        const execution = this.snapshotExecution();
        const timeoutMs = this.timeoutMs;

        try {
            const nativeResults = await this.withTimeout(
                executeScript({
                    target: this.toNativeTarget(target),
                    func: func as unknown as (...args: JsonValue[]) => R,
                    ...(execution.world !== undefined ? {world: execution.world} : {}),
                    ...(execution.runAt === "document_start" ? {injectImmediately: true} : {}),
                    ...(args ? {args: [...args] as JsonValue[]} : {}),
                }),
                target,
                timeoutMs
            );

            return sortInjectionResults(
                nativeResults.map(result => normalizeNativeInjectionResult<Awaited<R>>(target.tabId, result))
            );
        } catch (error) {
            if (this.isUnsupportedDocumentTargetError(target, error)) {
                throw new UnsupportedInjectScriptTargetError(
                    '"documentIds" are not supported by the current browser.',
                    error
                );
            }

            this.throwUnsupportedExecutionCapability(execution, error);

            throw this.deliveryError(target, error);
        }
    }

    public async file(files: string | NonEmptyReadonlyArray<string>): Promise<void> {
        const fileList = this.normalizeFiles(files);
        const target = this.snapshotTarget();
        const execution = this.snapshotExecution();
        const timeoutMs = this.timeoutMs;

        try {
            await this.withTimeout(
                executeScript({
                    target: this.toNativeTarget(target),
                    files: fileList,
                    ...(execution.world !== undefined ? {world: execution.world} : {}),
                    ...(execution.runAt === "document_start" ? {injectImmediately: true} : {}),
                }).then(() => undefined),
                target,
                timeoutMs
            );
        } catch (error) {
            if (this.isUnsupportedDocumentTargetError(target, error)) {
                throw new UnsupportedInjectScriptTargetError(
                    '"documentIds" are not supported by the current browser.',
                    error
                );
            }

            this.throwUnsupportedExecutionCapability(execution, error);

            throw this.deliveryError(target, error);
        }
    }

    protected assertAdapterSupport(_target: InjectScriptTarget, execution: InjectScriptExecutionOptions): void {
        if (execution.matchAboutBlank !== undefined) {
            throw new UnsupportedInjectScriptOptionError('"matchAboutBlank" is not supported by the MV3 adapter.');
        }

        if (execution.runAt === "document_end") {
            throw new UnsupportedInjectScriptOptionError(
                '"runAt: document_end" cannot be represented by the MV3 scripting API.'
            );
        }
    }

    private toNativeTarget(target: InjectScriptTarget): InjectionTarget {
        if ("frameIds" in target && target.frameIds !== undefined) {
            return {tabId: target.tabId, frameIds: [...target.frameIds]};
        }

        if ("documentIds" in target && target.documentIds !== undefined) {
            return {tabId: target.tabId, documentIds: [...target.documentIds]};
        }

        if ("allFrames" in target && target.allFrames === true) {
            return {tabId: target.tabId, allFrames: true};
        }

        return {tabId: target.tabId};
    }

    private isUnsupportedDocumentTargetError(target: InjectScriptTarget, error: unknown): boolean {
        if (!("documentIds" in target) || target.documentIds === undefined) {
            return false;
        }

        const message = error instanceof Error ? error.message : String(error);

        return /documentIds?/i.test(message) && this.isUnsupportedCapabilityMessage(message);
    }

    private throwUnsupportedExecutionCapability(execution: InjectScriptExecutionOptions, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);

        if (
            execution.world !== undefined &&
            /\bworld\b/i.test(message) &&
            this.isUnsupportedCapabilityMessage(message)
        ) {
            throw new UnsupportedInjectScriptOptionError('"world" is not supported by the current browser.', error);
        }

        if (
            execution.runAt === "document_start" &&
            /injectImmediately/i.test(message) &&
            this.isUnsupportedCapabilityMessage(message)
        ) {
            throw new UnsupportedInjectScriptOptionError(
                '"runAt: document_start" is not supported by the current browser.',
                error
            );
        }
    }

    private isUnsupportedCapabilityMessage(message: string): boolean {
        // Native extension APIs expose validation failures as messages rather than stable error codes.
        // Keep this matcher paired with browser-message fixtures in tests.
        return /(not supported|unsupported|unexpected|unknown|unrecognized|invalid|not (?:a )?valid)\b/i.test(message);
    }
}
