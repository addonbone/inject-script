import {
    type InjectScriptResult,
    type InjectScriptResultTarget,
    type InjectScriptTargetError,
    InjectScriptTargetErrorKind,
    type SerializedInjectScriptError,
} from "./types";
import {findJsonCompatibilityIssue} from "./validation";

type NonTimeoutTargetErrorKind = Exclude<`${InjectScriptTargetErrorKind}`, `${InjectScriptTargetErrorKind.Timeout}`>;

interface NativeInjectionResult<T> {
    frameId: number;
    documentId?: string;
    result?: T;
    error?: unknown;
}

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

export const createFrameResultTarget = (
    tabId: number,
    frameId: number,
    documentId?: string
): InjectScriptResultTarget => {
    return {
        tabId,
        frameId,
        ...(documentId ? {documentId} : {}),
    };
};

export const createDocumentResultTarget = (
    tabId: number,
    documentId: string,
    frameId?: number
): InjectScriptResultTarget => {
    return {
        tabId,
        documentId,
        ...(frameId !== undefined ? {frameId} : {}),
    };
};

export const createAllFramesResultTarget = (tabId: number): InjectScriptResultTarget => {
    return {tabId, allFrames: true};
};

export const createTargetFailure = (
    target: InjectScriptResultTarget,
    kind: NonTimeoutTargetErrorKind,
    error: unknown
): InjectScriptResult<never> => {
    return {
        success: false,
        target,
        error: {
            kind,
            ...serializeError(error),
        },
    };
};

export const createTargetTimeoutFailure = (
    target: InjectScriptResultTarget,
    timeoutMs: number,
    error: unknown,
    missingCount?: number
): InjectScriptResult<never> => {
    return {
        success: false,
        target,
        error: {
            kind: InjectScriptTargetErrorKind.Timeout,
            ...serializeError(error),
            timeoutMs,
            ...(missingCount !== undefined ? {missingCount} : {}),
        },
    };
};

export const createTargetSuccess = <T>(target: InjectScriptResultTarget, value: T): InjectScriptResult<T> => {
    return {success: true, target, value};
};

export const classifyTargetDeliveryError = (
    error: unknown
): typeof InjectScriptTargetErrorKind.Delivery | typeof InjectScriptTargetErrorKind.TargetGone => {
    const message = error instanceof Error ? error.message : String(error);

    return /\bNo (?:frame|document|tab) with id\b|\b(?:frame|document|tab) (?:was )?(?:removed|not found|does not exist)\b/i.test(
        message
    )
        ? InjectScriptTargetErrorKind.TargetGone
        : InjectScriptTargetErrorKind.Delivery;
};

const mergeObservedTarget = (
    requestedTarget: InjectScriptResultTarget | undefined,
    tabId: number,
    nativeResult: NativeInjectionResult<unknown>
): InjectScriptResultTarget => {
    if (requestedTarget && "documentId" in requestedTarget && requestedTarget.documentId !== undefined) {
        return createDocumentResultTarget(tabId, requestedTarget.documentId, nativeResult.frameId);
    }

    return createFrameResultTarget(tabId, nativeResult.frameId, nativeResult.documentId);
};

export const normalizeNativeInjectionResult = <T>(
    tabId: number,
    nativeResult: NativeInjectionResult<unknown>,
    requestedTarget?: InjectScriptResultTarget
): InjectScriptResult<T> => {
    const target = mergeObservedTarget(requestedTarget, tabId, nativeResult);

    if ("result" in nativeResult && nativeResult.result !== undefined) {
        const issue = findJsonCompatibilityIssue(nativeResult.result, "result");

        if (issue) {
            return createTargetFailure(
                target,
                InjectScriptTargetErrorKind.Execution,
                new TypeError(`Injected function result is not JSON-compatible: ${issue.path} ${issue.reason}`)
            );
        }

        return createTargetSuccess(target, nativeResult.result as T);
    }

    if ("error" in nativeResult) {
        return createTargetFailure(target, InjectScriptTargetErrorKind.Execution, nativeResult.error);
    }

    return createTargetFailure(
        target,
        InjectScriptTargetErrorKind.Unobservable,
        new Error("The browser did not expose an observable injected function result.")
    );
};

export const sortInjectionResults = <T>(results: InjectScriptResult<T>[]): InjectScriptResult<T>[] => {
    return [...results].sort((left, right) => {
        const leftFrameId = "frameId" in left.target ? left.target.frameId : undefined;
        const rightFrameId = "frameId" in right.target ? right.target.frameId : undefined;
        const frameOrder = (leftFrameId ?? Number.MAX_SAFE_INTEGER) - (rightFrameId ?? Number.MAX_SAFE_INTEGER);

        if (frameOrder !== 0) {
            return frameOrder;
        }

        const leftDocumentId = "documentId" in left.target ? (left.target.documentId ?? "") : "";
        const rightDocumentId = "documentId" in right.target ? (right.target.documentId ?? "") : "";

        return leftDocumentId.localeCompare(rightDocumentId);
    });
};

export const normalizeInjectionError = serializeError;

export const withTargetErrorKind = (
    kind: NonTimeoutTargetErrorKind,
    error: SerializedInjectScriptError
): InjectScriptTargetError => {
    return {kind, ...error};
};
