import {executeScriptTab, onMessage} from "@addon-core/browser";
import AbstractInjectScript from "./AbstractInjectScript";
import {
    InjectScriptDeliveryError,
    InjectScriptTimeoutError,
    UnsupportedInjectScriptOptionError,
    UnsupportedInjectScriptTargetError,
} from "./errors";
import {createRequestId} from "./requestId";
import {createResultTarget, normalizeInjectionError, sortInjectionResults} from "./results";
import {findJsonCompatibilityIssue} from "./validation";
import type {
    InjectScriptExecutionOptions,
    InjectScriptOptions,
    InjectScriptResult,
    InjectScriptTarget,
    NonEmptyReadonlyArray,
    SerializedInjectScriptError,
} from "./types";

type MessageSender = chrome.runtime.MessageSender;
type InjectDetails = chrome.extensionTypes.InjectDetails;

type InjectedOutcome<T> = {status: "fulfilled"; result: T} | {status: "rejected"; error: SerializedInjectScriptError};

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

        return new Promise<InjectScriptResult<Awaited<R>>[]>((resolve, reject) => {
            const messageType = createRequestId();
            const results = new Map<number, InjectScriptResult<Awaited<R>>>();
            const knownFrameIds = this.getKnownFrameIds(target);

            let expectedCount: number | undefined;
            let deliveryCompleted = false;
            let settled = false;

            const finish = (callback: () => void): void => {
                if (settled) return;

                settled = true;
                unsubscribe();
                clearTimeout(timeoutId);
                callback();
            };

            const maybeResolve = (): void => {
                if (!deliveryCompleted) return;

                if (knownFrameIds) {
                    if (knownFrameIds.some(frameId => !results.has(frameId))) return;
                } else if (expectedCount === undefined || results.size < expectedCount) {
                    return;
                }

                finish(() => resolve(sortInjectionResults([...results.values()])));
            };

            const listener = (message: unknown, sender: MessageSender): void => {
                if (!this.isInjectedResponse(message, messageType)) return;
                if (sender.tab?.id !== target.tabId) return;

                const {frameId, documentId} = sender;

                if (frameId === undefined) {
                    finish(() =>
                        reject(
                            new InjectScriptDeliveryError(
                                target,
                                new Error("The injected response did not include a frame ID.")
                            )
                        )
                    );
                    return;
                }

                if (!this.isExpectedFrame(target, frameId)) return;
                if (results.has(frameId)) return;

                const resultTarget = createResultTarget(target.tabId, frameId, documentId);
                const outcome = message.data;

                results.set(
                    frameId,
                    outcome.status === "fulfilled"
                        ? {
                              target: resultTarget,
                              status: "fulfilled",
                              result: outcome.result as Awaited<R>,
                          }
                        : {
                              target: resultTarget,
                              status: "rejected",
                              error: normalizeInjectionError(outcome.error),
                          }
                );

                maybeResolve();
            };

            const unsubscribe = onMessage(listener);

            const timeoutId = setTimeout(() => {
                const partialResults = sortInjectionResults([...results.values()]);

                if (deliveryCompleted && knownFrameIds) {
                    for (const frameId of knownFrameIds) {
                        if (results.has(frameId)) continue;

                        results.set(frameId, {
                            target: createResultTarget(target.tabId, frameId),
                            status: "unknown",
                        });
                    }

                    finish(() => resolve(sortInjectionResults([...results.values()])));
                    return;
                }

                const missingCount =
                    expectedCount === undefined ? undefined : Math.max(0, expectedCount - results.size);

                finish(() => reject(new InjectScriptTimeoutError(target, timeoutMs, {partialResults, missingCount})));
            }, timeoutMs);

            const details: InjectDetails = {
                code: this.getCode(messageType, func, args),
                ...(execution.runAt !== undefined ? {runAt: execution.runAt} : {}),
                ...(execution.matchAboutBlank !== undefined ? {matchAboutBlank: execution.matchAboutBlank} : {}),
            };

            void this.executeRun(target, details)
                .then(count => {
                    deliveryCompleted = true;
                    expectedCount = count;
                    maybeResolve();
                })
                .catch(error => {
                    finish(() => reject(this.deliveryError(target, error)));
                });
        });
    }

    public async file(files: string | NonEmptyReadonlyArray<string>): Promise<void> {
        const fileList = this.normalizeFiles(files);
        const target = this.snapshotTarget();
        const execution = this.snapshotExecution();
        const timeoutMs = this.timeoutMs;
        let stopped = false;

        const task = (async (): Promise<void> => {
            for (const file of fileList) {
                if (stopped) return;

                const details: InjectDetails = {
                    file,
                    ...(execution.runAt !== undefined ? {runAt: execution.runAt} : {}),
                    ...(execution.matchAboutBlank !== undefined ? {matchAboutBlank: execution.matchAboutBlank} : {}),
                };

                await this.executeFile(target, details);
            }
        })();

        try {
            await this.withTimeout(task, target, timeoutMs);
        } catch (error) {
            stopped = true;
            throw this.deliveryError(target, error);
        }
    }

    protected assertAdapterSupport(target: InjectScriptTarget, execution: InjectScriptExecutionOptions): void {
        if ("documentIds" in target && target.documentIds !== undefined) {
            throw new UnsupportedInjectScriptTargetError('"documentIds" are not supported by the MV2 adapter.');
        }

        if (execution.world !== undefined && execution.world !== "ISOLATED") {
            throw new UnsupportedInjectScriptOptionError('"world: MAIN" is not supported by the MV2 adapter.');
        }
    }

    private async executeRun(target: InjectScriptTarget, details: InjectDetails): Promise<number> {
        if ("allFrames" in target && target.allFrames === true) {
            const nativeResults = await executeScriptTab(target.tabId, {...details, allFrames: true});

            return this.getNativeResultCount(nativeResults);
        }

        if ("frameIds" in target && target.frameIds !== undefined) {
            const nativeResults = await Promise.all(
                target.frameIds.map(frameId => executeScriptTab(target.tabId, {...details, frameId}))
            );

            return nativeResults.reduce((count, result) => count + this.getNativeResultCount(result), 0);
        }

        const nativeResults = await executeScriptTab(target.tabId, details);

        return this.getNativeResultCount(nativeResults);
    }

    private async executeFile(target: InjectScriptTarget, details: InjectDetails): Promise<void> {
        if ("allFrames" in target && target.allFrames === true) {
            await executeScriptTab(target.tabId, {...details, allFrames: true});
            return;
        }

        if ("frameIds" in target && target.frameIds !== undefined) {
            await Promise.all(target.frameIds.map(frameId => executeScriptTab(target.tabId, {...details, frameId})));
            return;
        }

        await executeScriptTab(target.tabId, details);
    }

    private getNativeResultCount(results: unknown[] | undefined): number {
        if (!Array.isArray(results)) {
            throw new Error("The browser did not report how many frames received the injected script.");
        }

        return results.length;
    }

    private isInjectedResponse(
        message: unknown,
        messageType: string
    ): message is {type: string; data: InjectedOutcome<unknown>} {
        if (typeof message !== "object" || message === null) return false;

        const candidate = message as {type?: unknown; data?: unknown};

        if (candidate.type !== messageType || typeof candidate.data !== "object" || candidate.data === null) {
            return false;
        }

        const outcome = candidate.data as {status?: unknown};

        return outcome.status === "fulfilled" || outcome.status === "rejected";
    }

    private getKnownFrameIds(target: InjectScriptTarget): readonly number[] | undefined {
        if ("allFrames" in target && target.allFrames === true) return undefined;
        if ("frameIds" in target && target.frameIds !== undefined) return target.frameIds;

        return [0];
    }

    private isExpectedFrame(target: InjectScriptTarget, frameId: number): boolean {
        const knownFrameIds = this.getKnownFrameIds(target);

        return knownFrameIds === undefined || knownFrameIds.includes(frameId);
    }

    private getCode<A extends readonly unknown[], R>(messageType: string, func: (...args: A) => R, args?: A): string {
        const codeSource = this.generateCode().toString();
        const funcSource = func.toString();
        const validatorSource = findJsonCompatibilityIssue.toString();
        const serializedType = JSON.stringify(messageType);
        const serializedArgs = JSON.stringify(args ?? []);

        return `(${codeSource})(${serializedType}, ${funcSource}, ${serializedArgs}, ${validatorSource})`;
    }

    private generateCode(): (
        type: string,
        func: (...args: unknown[]) => unknown,
        args: unknown[],
        findCompatibilityIssue: typeof findJsonCompatibilityIssue
    ) => void {
        return (
            type: string,
            func: (...args: unknown[]) => unknown,
            args: unknown[],
            findCompatibilityIssue: typeof findJsonCompatibilityIssue
        ): void => {
            const sendMessage = (message: unknown): void => {
                const browserApi = (globalThis as unknown as {browser?: typeof chrome}).browser;
                const chromeApi = (globalThis as unknown as {chrome?: typeof chrome}).chrome;
                const promiseApi = browserApi?.runtime?.id ? browserApi : undefined;
                const callbackApi = chromeApi?.runtime?.id ? chromeApi : undefined;
                const api = promiseApi ?? callbackApi;

                if (!api) return;

                try {
                    if (promiseApi) {
                        const dispatch = promiseApi.runtime.sendMessage(message) as unknown;

                        if (
                            typeof dispatch === "object" &&
                            dispatch !== null &&
                            "then" in dispatch &&
                            typeof dispatch.then === "function"
                        ) {
                            Promise.resolve(dispatch).catch(error => {
                                console.error(
                                    `Failed to send a message from the injected script: ${
                                        error instanceof Error ? error.message : String(error)
                                    }`
                                );
                            });
                        }

                        return;
                    }

                    callbackApi?.runtime.sendMessage(message);
                } catch (error) {
                    console.error(
                        `Unexpected exception during message dispatch from injected context: ${
                            error instanceof Error ? error.message : String(error)
                        }`
                    );
                }
            };

            const serializeError = (value: unknown): SerializedInjectScriptError => {
                if (value instanceof Error) {
                    return {
                        name: value.name || "Error",
                        message: value.message,
                        ...(value.stack ? {stack: value.stack} : {}),
                    };
                }

                if (typeof value === "object" && value !== null) {
                    const candidate = value as {name?: unknown; message?: unknown; stack?: unknown};

                    return {
                        name: typeof candidate.name === "string" && candidate.name ? candidate.name : "Error",
                        message: typeof candidate.message === "string" ? candidate.message : String(value),
                        ...(typeof candidate.stack === "string" && candidate.stack ? {stack: candidate.stack} : {}),
                    };
                }

                return {name: "Error", message: String(value)};
            };

            Promise.resolve()
                .then(() => func(...args))
                .then(result => {
                    const issue = findCompatibilityIssue(result, "result");

                    if (issue) {
                        throw new TypeError(
                            `Injected function result is not JSON-compatible: ${issue.path} ${issue.reason}`
                        );
                    }

                    sendMessage({type, data: {status: "fulfilled", result}});
                })
                .catch(error => {
                    sendMessage({type, data: {status: "rejected", error: serializeError(error)}});
                });
        };
    }
}
