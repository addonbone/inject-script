import {findJsonCompatibilityIssue} from "./validation";
import type {InjectScriptResult, InjectScriptResultTarget, SerializedInjectScriptError} from "./types";

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

export const createResultTarget = (tabId: number, frameId: number, documentId?: string): InjectScriptResultTarget => {
    return {
        tabId,
        frameId,
        ...(documentId ? {documentId} : {}),
    };
};

export const normalizeNativeInjectionResult = <T>(
    tabId: number,
    nativeResult: NativeInjectionResult<unknown>
): InjectScriptResult<T> => {
    const target = createResultTarget(tabId, nativeResult.frameId, nativeResult.documentId);

    if ("result" in nativeResult && nativeResult.result !== undefined) {
        const issue = findJsonCompatibilityIssue(nativeResult.result, "result");

        if (issue) {
            return {
                target,
                status: "rejected",
                error: {
                    name: "TypeError",
                    message: `Injected function result is not JSON-compatible: ${issue.path} ${issue.reason}`,
                },
            };
        }

        return {target, status: "fulfilled", result: nativeResult.result as T};
    }

    if ("error" in nativeResult) {
        return {target, status: "rejected", error: serializeError(nativeResult.error)};
    }

    return {target, status: "unknown"};
};

export const sortInjectionResults = <T>(results: InjectScriptResult<T>[]): InjectScriptResult<T>[] => {
    return [...results].sort((left, right) => {
        const frameOrder = left.target.frameId - right.target.frameId;

        if (frameOrder !== 0) {
            return frameOrder;
        }

        return (left.target.documentId ?? "").localeCompare(right.target.documentId ?? "");
    });
};

export const normalizeInjectionError = serializeError;
