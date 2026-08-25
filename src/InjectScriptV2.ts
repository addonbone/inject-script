import {executeScriptTab, onMessage} from "@addon-core/browser";
import AbstractInjectScript from "./AbstractInjectScript";
import {
    InjectScriptTimeoutError,
    UnsupportedInjectScriptOptionError,
    UnsupportedInjectScriptTargetError,
} from "./errors";
import {createRequestId} from "./requestId";
import {
    classifyTargetDeliveryError,
    createAllFramesResultTarget,
    createFrameResultTarget,
    createTargetFailure,
    createTargetSuccess,
    createTargetTimeoutFailure,
    normalizeInjectionError,
    sortInjectionResults,
    withTargetErrorKind,
} from "./results";
import {InjectScriptTargetErrorKind} from "./types";
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

interface PendingExplicitFrame<T> {
    frameId: number;
    messageType: string;
    promise: Promise<InjectScriptResult<T>>;
    resolve: (result: InjectScriptResult<T>) => void;
    timeoutId?: ReturnType<typeof setTimeout>;
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
        const createCode = this.createCodeBuilder(func, args);

        if ("allFrames" in target && target.allFrames === true) {
            return this.runAllFrames(target, execution, timeoutMs, createCode);
        }

        const frameIds = "frameIds" in target && target.frameIds !== undefined ? target.frameIds : ([0] as const);
        const baseDetails = this.createRunDetails(execution);

        return this.runExplicitFrames<Awaited<R>>(target.tabId, frameIds, baseDetails, timeoutMs, createCode);
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

    private runExplicitFrames<T>(
        tabId: number,
        frameIds: NonEmptyReadonlyArray<number>,
        baseDetails: Partial<Pick<InjectDetails, "matchAboutBlank" | "runAt">>,
        timeoutMs: number,
        createCode: (messageType: string) => string
    ): Promise<InjectScriptResult<T>[]> {
        const pending = new Map<string, PendingExplicitFrame<T>>();
        const requests = frameIds.map<PendingExplicitFrame<T>>(frameId => {
            const messageType = createRequestId();
            let resolveResult!: (result: InjectScriptResult<T>) => void;
            const promise = new Promise<InjectScriptResult<T>>(resolve => {
                resolveResult = resolve;
            });

            const request: PendingExplicitFrame<T> = {
                frameId,
                messageType,
                promise,
                resolve: resolveResult,
            };

            pending.set(messageType, request);

            return request;
        });

        let unsubscribe = (): void => {};

        const finish = (request: PendingExplicitFrame<T>, result: InjectScriptResult<T>): void => {
            if (pending.get(request.messageType) !== request) return;

            pending.delete(request.messageType);

            if (request.timeoutId !== undefined) {
                clearTimeout(request.timeoutId);
            }

            request.resolve(result);

            if (pending.size === 0) {
                unsubscribe();
            }
        };

        const listener = (message: unknown, sender: MessageSender): void => {
            if (typeof message !== "object" || message === null) return;

            const messageType = (message as {type?: unknown}).type;

            if (typeof messageType !== "string") return;

            const request = pending.get(messageType);

            if (!request || !this.isInjectedResponse(message, messageType)) return;
            if (sender.tab?.id !== tabId) return;

            const resultTarget = createFrameResultTarget(tabId, request.frameId);

            if (sender.frameId === undefined) {
                finish(
                    request,
                    createTargetFailure(
                        resultTarget,
                        InjectScriptTargetErrorKind.Delivery,
                        new Error("The injected response did not include a frame ID.")
                    )
                );
                return;
            }

            if (sender.frameId !== request.frameId) return;

            const observedTarget = createFrameResultTarget(tabId, request.frameId, sender.documentId);
            const outcome = message.data;

            finish(
                request,
                outcome.status === "fulfilled"
                    ? createTargetSuccess(observedTarget, outcome.result as T)
                    : {
                          success: false,
                          target: observedTarget,
                          error: withTargetErrorKind(
                              InjectScriptTargetErrorKind.Execution,
                              normalizeInjectionError(outcome.error)
                          ),
                      }
            );
        };

        try {
            unsubscribe = onMessage(listener);
        } catch (error) {
            for (const request of requests) {
                finish(
                    request,
                    createTargetFailure(
                        createFrameResultTarget(tabId, request.frameId),
                        InjectScriptTargetErrorKind.Delivery,
                        error
                    )
                );
            }

            return Promise.all(requests.map(request => request.promise));
        }

        // Preserve user activation: every native call is initiated before the first await.
        for (const request of requests) {
            const resultTarget = createFrameResultTarget(tabId, request.frameId);
            const requestTarget: InjectScriptTarget = {tabId, frameIds: [request.frameId]};

            request.timeoutId = setTimeout(() => {
                finish(
                    request,
                    createTargetTimeoutFailure(
                        resultTarget,
                        timeoutMs,
                        new InjectScriptTimeoutError(requestTarget, timeoutMs)
                    )
                );
            }, timeoutMs);

            try {
                const details: InjectDetails = {
                    ...baseDetails,
                    code: createCode(request.messageType),
                    frameId: request.frameId,
                };

                void executeScriptTab(tabId, details)
                    .then(nativeResults => {
                        if (!pending.has(request.messageType)) return;

                        try {
                            if (this.getNativeResultCount(nativeResults) === 0) {
                                finish(
                                    request,
                                    createTargetFailure(
                                        resultTarget,
                                        InjectScriptTargetErrorKind.Delivery,
                                        new Error("The browser did not execute the script in the requested frame.")
                                    )
                                );
                            }
                        } catch (error) {
                            finish(
                                request,
                                createTargetFailure(resultTarget, InjectScriptTargetErrorKind.Delivery, error)
                            );
                        }
                    })
                    .catch(error => {
                        finish(request, createTargetFailure(resultTarget, classifyTargetDeliveryError(error), error));
                    });
            } catch (error) {
                finish(request, createTargetFailure(resultTarget, classifyTargetDeliveryError(error), error));
            }
        }

        return Promise.all(requests.map(request => request.promise));
    }

    private runAllFrames<T>(
        target: InjectScriptTarget,
        execution: InjectScriptExecutionOptions,
        timeoutMs: number,
        createCode: (messageType: string) => string
    ): Promise<InjectScriptResult<T>[]> {
        return new Promise<InjectScriptResult<T>[]>(resolve => {
            const messageType = createRequestId();
            const results = new Map<number, InjectScriptResult<T>>();
            const operationTarget = createAllFramesResultTarget(target.tabId);

            let expectedCount: number | undefined;
            let deliveryCompleted = false;
            let settled = false;

            const finish = (outcomes: InjectScriptResult<T>[]): void => {
                if (settled) return;

                settled = true;
                unsubscribe();
                clearTimeout(timeoutId);
                resolve(sortInjectionResults(outcomes));
            };

            const maybeResolve = (): void => {
                if (!deliveryCompleted || expectedCount === undefined || results.size < expectedCount) return;

                finish([...results.values()]);
            };

            const listener = (message: unknown, sender: MessageSender): void => {
                if (!this.isInjectedResponse(message, messageType)) return;
                if (sender.tab?.id !== target.tabId) return;

                const {frameId, documentId} = sender;

                if (frameId === undefined) {
                    finish([
                        ...results.values(),
                        createTargetFailure(
                            operationTarget,
                            InjectScriptTargetErrorKind.Delivery,
                            new Error("The injected response did not include a frame ID.")
                        ),
                    ]);
                    return;
                }

                if (results.has(frameId)) return;

                const resultTarget = createFrameResultTarget(target.tabId, frameId, documentId);
                const outcome = message.data;

                results.set(
                    frameId,
                    outcome.status === "fulfilled"
                        ? createTargetSuccess(resultTarget, outcome.result as T)
                        : {
                              success: false,
                              target: resultTarget,
                              error: withTargetErrorKind(
                                  InjectScriptTargetErrorKind.Execution,
                                  normalizeInjectionError(outcome.error)
                              ),
                          }
                );

                maybeResolve();
            };

            const unsubscribe = onMessage(listener);
            const timeoutId = setTimeout(() => {
                const partialResults = sortInjectionResults([...results.values()]);
                const missingCount =
                    expectedCount === undefined ? undefined : Math.max(0, expectedCount - results.size);
                const timeoutError = new InjectScriptTimeoutError(target, timeoutMs);

                finish([
                    ...partialResults,
                    createTargetTimeoutFailure(operationTarget, timeoutMs, timeoutError, missingCount),
                ]);
            }, timeoutMs);
            const details: InjectDetails = {
                ...this.createRunDetails(execution),
                code: createCode(messageType),
                allFrames: true,
            };

            void executeScriptTab(target.tabId, details)
                .then(nativeResults => {
                    deliveryCompleted = true;

                    try {
                        expectedCount = this.getNativeResultCount(nativeResults);
                        maybeResolve();
                    } catch (error) {
                        finish([
                            ...results.values(),
                            createTargetFailure(operationTarget, InjectScriptTargetErrorKind.Delivery, error),
                        ]);
                    }
                })
                .catch(error => {
                    finish([
                        ...results.values(),
                        createTargetFailure(operationTarget, InjectScriptTargetErrorKind.Delivery, error),
                    ]);
                });
        });
    }

    private createRunDetails(
        execution: InjectScriptExecutionOptions
    ): Partial<Pick<InjectDetails, "matchAboutBlank" | "runAt">> {
        return {
            ...(execution.runAt !== undefined ? {runAt: execution.runAt} : {}),
            ...(execution.matchAboutBlank !== undefined ? {matchAboutBlank: execution.matchAboutBlank} : {}),
        };
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

    private createCodeBuilder<A extends readonly unknown[], R>(
        func: (...args: A) => R,
        args?: A
    ): (messageType: string) => string {
        const codeSource = this.generateCode().toString();
        const funcSource = func.toString();
        const validatorSource = findJsonCompatibilityIssue.toString();
        const serializedArgs = JSON.stringify(args ?? []);

        return messageType => {
            const serializedType = JSON.stringify(messageType);

            return `(${codeSource})(${serializedType}, ${funcSource}, ${serializedArgs}, ${validatorSource})`;
        };
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
