import {executeScript} from "@addon-core/browser";
import AbstractInjectScript from "./AbstractInjectScript";
import {
    InjectScriptTimeoutError,
    UnsupportedInjectScriptOptionError,
    UnsupportedInjectScriptTargetError,
} from "./errors";
import {
    classifyTargetDeliveryError,
    createAllFramesResultTarget,
    createDocumentResultTarget,
    createFrameResultTarget,
    createTargetFailure,
    createTargetTimeoutFailure,
    normalizeNativeInjectionResult,
    sortInjectionResults,
} from "./results";
import {InjectScriptTargetErrorKind} from "./types";
import type {
    InjectScriptExecutionOptions,
    InjectScriptOptions,
    InjectScriptResult,
    InjectScriptResultTarget,
    InjectScriptTarget,
    JsonValue,
    NonEmptyReadonlyArray,
} from "./types";

type InjectionTarget = chrome.scripting.InjectionTarget;
type NativeInjectionResult<T> = chrome.scripting.InjectionResult<T>;

interface ExplicitExecutionTarget {
    nativeTarget: InjectionTarget;
    requestTarget: InjectScriptTarget;
    resultTarget: InjectScriptResultTarget;
}

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

        if ("frameIds" in target && target.frameIds !== undefined) {
            const targets: ExplicitExecutionTarget[] = target.frameIds.map(frameId => ({
                nativeTarget: {tabId: target.tabId, frameIds: [frameId]},
                requestTarget: {tabId: target.tabId, frameIds: [frameId]},
                resultTarget: createFrameResultTarget(target.tabId, frameId),
            }));

            return this.runExplicitTargets(targets, func, args, execution, timeoutMs);
        }

        if ("documentIds" in target && target.documentIds !== undefined) {
            const targets: ExplicitExecutionTarget[] = target.documentIds.map(documentId => ({
                nativeTarget: {tabId: target.tabId, documentIds: [documentId]},
                requestTarget: {tabId: target.tabId, documentIds: [documentId]},
                resultTarget: createDocumentResultTarget(target.tabId, documentId),
            }));

            return this.runExplicitTargets(targets, func, args, execution, timeoutMs);
        }

        const resultTarget =
            "allFrames" in target && target.allFrames === true
                ? createAllFramesResultTarget(target.tabId)
                : createFrameResultTarget(target.tabId, 0);

        try {
            const nativeResults = await this.withTimeout(
                this.executeFunction(this.toNativeTarget(target), func, args, execution),
                target,
                timeoutMs
            );

            if ("allFrames" in target && target.allFrames === true) {
                return sortInjectionResults(
                    nativeResults.map(result => normalizeNativeInjectionResult<Awaited<R>>(target.tabId, result))
                );
            }

            return [this.normalizeSingleNativeResult(target.tabId, resultTarget, nativeResults)];
        } catch (error) {
            if (this.isUnsupportedDocumentTargetError(target, error)) {
                throw new UnsupportedInjectScriptTargetError(
                    '"documentIds" are not supported by the current browser.',
                    error
                );
            }

            this.throwUnsupportedExecutionCapability(execution, error);

            if (error instanceof InjectScriptTimeoutError) {
                return [createTargetTimeoutFailure(resultTarget, timeoutMs, error)];
            }

            return [
                createTargetFailure(
                    resultTarget,
                    "allFrames" in target && target.allFrames === true
                        ? InjectScriptTargetErrorKind.Delivery
                        : classifyTargetDeliveryError(error),
                    error
                ),
            ];
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

    private async runExplicitTargets<A extends readonly unknown[], R>(
        targets: readonly ExplicitExecutionTarget[],
        func: (...args: A) => R,
        args: A | undefined,
        execution: InjectScriptExecutionOptions,
        timeoutMs: number
    ): Promise<InjectScriptResult<Awaited<R>>[]> {
        // Preserve user activation: every native call is initiated before the first await.
        const executions = targets.map(target => ({
            target,
            promise: this.withTimeout(
                this.executeFunction(target.nativeTarget, func, args, execution),
                target.requestTarget,
                timeoutMs
            ),
        }));
        const settled = await Promise.allSettled(executions.map(executionItem => executionItem.promise));

        for (let index = 0; index < settled.length; index += 1) {
            const outcome = settled[index];

            if (outcome.status === "fulfilled") continue;

            const target = executions[index].target.requestTarget;

            if (this.isUnsupportedDocumentTargetError(target, outcome.reason)) {
                throw new UnsupportedInjectScriptTargetError(
                    '"documentIds" are not supported by the current browser.',
                    outcome.reason
                );
            }

            this.throwUnsupportedExecutionCapability(execution, outcome.reason);
        }

        return settled.map((outcome, index) => {
            const {resultTarget} = executions[index].target;

            if (outcome.status === "fulfilled") {
                return this.normalizeSingleNativeResult(
                    targets[index].requestTarget.tabId,
                    resultTarget,
                    outcome.value
                );
            }

            if (outcome.reason instanceof InjectScriptTimeoutError) {
                return createTargetTimeoutFailure(resultTarget, timeoutMs, outcome.reason);
            }

            return createTargetFailure(resultTarget, classifyTargetDeliveryError(outcome.reason), outcome.reason);
        });
    }

    private executeFunction<A extends readonly unknown[], R>(
        target: InjectionTarget,
        func: (...args: A) => R,
        args: A | undefined,
        execution: InjectScriptExecutionOptions
    ): Promise<NativeInjectionResult<unknown>[]> {
        return executeScript({
            target,
            func: func as unknown as (...args: JsonValue[]) => R,
            ...(execution.world !== undefined ? {world: execution.world} : {}),
            ...(execution.runAt === "document_start" ? {injectImmediately: true} : {}),
            ...(args ? {args: [...args] as JsonValue[]} : {}),
        }) as unknown as Promise<NativeInjectionResult<unknown>[]>;
    }

    private normalizeSingleNativeResult<T>(
        tabId: number,
        requestedTarget: InjectScriptResultTarget,
        nativeResults: NativeInjectionResult<unknown>[]
    ): InjectScriptResult<T> {
        const exactResult = nativeResults.find(result => {
            if ("documentId" in requestedTarget && requestedTarget.documentId !== undefined) {
                return result.documentId === requestedTarget.documentId;
            }

            return "frameId" in requestedTarget && result.frameId === requestedTarget.frameId;
        });
        const nativeResult = exactResult ?? (nativeResults.length === 1 ? nativeResults[0] : undefined);

        if (!nativeResult) {
            return createTargetFailure(
                requestedTarget,
                InjectScriptTargetErrorKind.Delivery,
                new Error("The browser did not return an injection result for the requested target.")
            );
        }

        return normalizeNativeInjectionResult<T>(tabId, nativeResult, requestedTarget);
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

        return (
            /documentIds?/i.test(message) &&
            /(not supported|unsupported|unexpected|unknown|unrecognized)\b/i.test(message)
        );
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
