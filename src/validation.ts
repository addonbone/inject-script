import {
    InvalidInjectScriptArgumentsError,
    InvalidInjectScriptFilesError,
    InvalidInjectScriptOptionsError,
    InvalidInjectScriptTargetError,
} from "./errors";
import type {InjectScriptExecutionOptions, InjectScriptTarget, NonEmptyReadonlyArray} from "./types";

const TARGET_KEYS = new Set(["tabId", "allFrames", "frameIds", "documentIds"]);
const EXECUTION_OPTION_KEYS = new Set(["matchAboutBlank", "runAt", "timeoutMs", "world"]);
const INJECT_SCRIPT_OPTION_KEYS = new Set(["target", ...EXECUTION_OPTION_KEYS]);
const RUN_AT_VALUES = new Set(["document_start", "document_end", "document_idle"]);
const WORLD_VALUES = new Set(["ISOLATED", "MAIN"]);

const isObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === "object" && value !== null && !Array.isArray(value);
};

const assertKnownKeys = (value: Record<string, unknown>, keys: Set<string>, subject: string): void => {
    const unknownKeys = Object.keys(value).filter(key => !keys.has(key));

    if (unknownKeys.length > 0) {
        throw new InvalidInjectScriptOptionsError(
            `${subject} contains unknown ${unknownKeys.length === 1 ? "field" : "fields"}: ${unknownKeys
                .map(key => `"${key}"`)
                .join(", ")}.`
        );
    }
};

const cloneTarget = (target: InjectScriptTarget): InjectScriptTarget => {
    if ("frameIds" in target && target.frameIds !== undefined) {
        return {tabId: target.tabId, frameIds: [...target.frameIds] as NonEmptyReadonlyArray<number>};
    }

    if ("documentIds" in target && target.documentIds !== undefined) {
        return {tabId: target.tabId, documentIds: [...target.documentIds] as NonEmptyReadonlyArray<string>};
    }

    if ("allFrames" in target && target.allFrames === true) {
        return {tabId: target.tabId, allFrames: true};
    }

    return {tabId: target.tabId};
};

export const validateInjectScriptTarget = (value: unknown): InjectScriptTarget => {
    if (!isObject(value)) {
        throw new InvalidInjectScriptTargetError("target must be an object.");
    }

    const unknownKeys = Object.keys(value).filter(key => !TARGET_KEYS.has(key));

    if (unknownKeys.length > 0) {
        throw new InvalidInjectScriptTargetError(
            `target contains unknown ${unknownKeys.length === 1 ? "field" : "fields"}: ${unknownKeys
                .map(key => `"${key}"`)
                .join(", ")}.`
        );
    }

    if (!Number.isInteger(value.tabId) || (value.tabId as number) < 0) {
        throw new InvalidInjectScriptTargetError('"tabId" must be a non-negative integer.');
    }

    const selectors = ["allFrames", "frameIds", "documentIds"].filter(key => value[key] !== undefined);

    if (selectors.length > 1) {
        throw new InvalidInjectScriptTargetError('"allFrames", "frameIds", and "documentIds" are mutually exclusive.');
    }

    if (value.allFrames !== undefined && value.allFrames !== true) {
        throw new InvalidInjectScriptTargetError('"allFrames" must be exactly true when provided.');
    }

    if (value.frameIds !== undefined) {
        if (!Array.isArray(value.frameIds) || value.frameIds.length === 0) {
            throw new InvalidInjectScriptTargetError('"frameIds" must contain at least one frame ID.');
        }

        if (value.frameIds.some(frameId => !Number.isInteger(frameId) || frameId < 0)) {
            throw new InvalidInjectScriptTargetError("frame ID must be a non-negative integer.");
        }

        if (new Set(value.frameIds).size !== value.frameIds.length) {
            throw new InvalidInjectScriptTargetError('"frameIds" must not contain duplicate frame IDs.');
        }
    }

    if (value.documentIds !== undefined) {
        if (!Array.isArray(value.documentIds) || value.documentIds.length === 0) {
            throw new InvalidInjectScriptTargetError('"documentIds" must contain at least one document ID.');
        }

        if (value.documentIds.some(documentId => typeof documentId !== "string" || documentId.trim().length === 0)) {
            throw new InvalidInjectScriptTargetError("document ID must be a non-empty string.");
        }

        if (new Set(value.documentIds).size !== value.documentIds.length) {
            throw new InvalidInjectScriptTargetError('"documentIds" must not contain duplicate document IDs.');
        }
    }

    return cloneTarget(value as unknown as InjectScriptTarget);
};

export const validateInjectScriptExecutionOptions = (value: unknown): InjectScriptExecutionOptions => {
    if (!isObject(value)) {
        throw new InvalidInjectScriptOptionsError("execution options must be an object.");
    }

    assertKnownKeys(value, EXECUTION_OPTION_KEYS, "execution options");

    if (value.matchAboutBlank !== undefined && typeof value.matchAboutBlank !== "boolean") {
        throw new InvalidInjectScriptOptionsError('"matchAboutBlank" must be a boolean.');
    }

    if (value.runAt !== undefined && (typeof value.runAt !== "string" || !RUN_AT_VALUES.has(value.runAt))) {
        throw new InvalidInjectScriptOptionsError(
            '"runAt" must be "document_start", "document_end", or "document_idle".'
        );
    }

    if (
        value.timeoutMs !== undefined &&
        (typeof value.timeoutMs !== "number" || !Number.isInteger(value.timeoutMs) || value.timeoutMs <= 0)
    ) {
        throw new InvalidInjectScriptOptionsError('"timeoutMs" must be a positive integer.');
    }

    if (value.world !== undefined && (typeof value.world !== "string" || !WORLD_VALUES.has(value.world))) {
        throw new InvalidInjectScriptOptionsError('"world" must be "ISOLATED" or "MAIN".');
    }

    return {...(value as InjectScriptExecutionOptions)};
};

export const validateInjectScriptOptions = (
    value: unknown
): {target: InjectScriptTarget; execution: InjectScriptExecutionOptions} => {
    if (!isObject(value)) {
        throw new InvalidInjectScriptOptionsError("options must be an object.");
    }

    assertKnownKeys(value, INJECT_SCRIPT_OPTION_KEYS, "options");

    const {target, ...execution} = value;

    return {
        target: validateInjectScriptTarget(target),
        execution: validateInjectScriptExecutionOptions(execution),
    };
};

export interface JsonCompatibilityIssue {
    readonly path: string;
    readonly reason: string;
}

/**
 * This function must remain self-contained because MV2 serializes it into the
 * injected payload. Do not reference module-level values from its body.
 */
export const findJsonCompatibilityIssue = (value: unknown, path: string): JsonCompatibilityIssue | undefined => {
    const appendPropertyPath = (parent: string, key: string): string => {
        return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
    };

    const describeThrownValue = (thrown: unknown): string => {
        if (thrown instanceof Error && thrown.message) return thrown.message;

        try {
            return String(thrown);
        } catch {
            return "an unknown error";
        }
    };

    const inspect = (
        candidate: unknown,
        currentPath: string,
        ancestors: Map<object, string>
    ): JsonCompatibilityIssue | undefined => {
        if (candidate === null || typeof candidate === "boolean" || typeof candidate === "string") {
            return undefined;
        }

        if (typeof candidate === "number") {
            if (Number.isFinite(candidate)) return undefined;

            const valueName = Number.isNaN(candidate) ? "NaN" : candidate > 0 ? "Infinity" : "-Infinity";

            return {path: currentPath, reason: `is ${valueName}; JSON supports only finite numbers.`};
        }

        if (candidate === undefined) {
            return {
                path: currentPath,
                reason: "is undefined; JSON has no undefined value. Omit the key or use null.",
            };
        }

        if (typeof candidate !== "object") {
            return {
                path: currentPath,
                reason: `has type "${typeof candidate}"; JSON does not support values of this type.`,
            };
        }

        const ancestorPath = ancestors.get(candidate);

        if (ancestorPath !== undefined) {
            return {
                path: currentPath,
                reason: `contains a circular reference to ${ancestorPath}.`,
            };
        }

        let array: boolean;

        try {
            array = Array.isArray(candidate);
        } catch (error) {
            return {
                path: currentPath,
                reason: `could not be inspected: ${describeThrownValue(error)}.`,
            };
        }

        let prototype: object | null;

        try {
            prototype = Object.getPrototypeOf(candidate);
        } catch (error) {
            return {
                path: currentPath,
                reason: `could not be inspected: ${describeThrownValue(error)}.`,
            };
        }

        const plainPrototype = array
            ? prototype === Array.prototype
            : prototype === Object.prototype || prototype === null;

        if (!plainPrototype) {
            let constructorName: string | undefined;

            try {
                const constructorValue = (prototype as {constructor?: unknown} | null)?.constructor;

                if (
                    typeof constructorValue === "function" &&
                    constructorValue.name &&
                    constructorValue.name !== (array ? "Array" : "Object")
                ) {
                    constructorName = constructorValue.name;
                }
            } catch {
                // A hostile prototype must not hide the actionable plain-value requirement.
            }

            return {
                path: currentPath,
                reason: constructorName
                    ? `is a ${constructorName} instance; pass a plain ${array ? "array" : "object"}.`
                    : `is not a plain ${array ? "array" : "object"}; pass a plain ${array ? "array" : "object"}.`,
            };
        }

        ancestors.set(candidate, currentPath);

        let enumerableSymbol: symbol | undefined;

        try {
            enumerableSymbol = Object.getOwnPropertySymbols(candidate).find(symbol => {
                return Object.getOwnPropertyDescriptor(candidate, symbol)?.enumerable === true;
            });
        } catch (error) {
            ancestors.delete(candidate);

            return {
                path: currentPath,
                reason: `could not be inspected: ${describeThrownValue(error)}.`,
            };
        }

        if (enumerableSymbol !== undefined) {
            ancestors.delete(candidate);

            return {
                path: currentPath,
                reason: `has an enumerable symbol-keyed property (${String(enumerableSymbol)}); JSON supports only string property keys.`,
            };
        }

        if (array) {
            let length: number;
            let keys: string[];

            try {
                length = (candidate as unknown[]).length;
                keys = Object.keys(candidate);
            } catch (error) {
                ancestors.delete(candidate);

                return {
                    path: currentPath,
                    reason: `could not be inspected: ${describeThrownValue(error)}.`,
                };
            }

            const extraKey = keys.find(key => {
                const index = Number(key);

                return !Number.isInteger(index) || index < 0 || index >= length || String(index) !== key;
            });

            if (extraKey !== undefined) {
                ancestors.delete(candidate);

                return {
                    path: appendPropertyPath(currentPath, extraKey),
                    reason: "is an additional array property; JSON serializes only indexed array elements.",
                };
            }

            for (let index = 0; index < length; index += 1) {
                const itemPath = `${currentPath}[${index}]`;
                let hasItem: boolean;

                try {
                    hasItem = Object.getOwnPropertyDescriptor(candidate, index) !== undefined;
                } catch (error) {
                    ancestors.delete(candidate);

                    return {
                        path: itemPath,
                        reason: `could not be inspected: ${describeThrownValue(error)}.`,
                    };
                }

                if (!hasItem) {
                    ancestors.delete(candidate);

                    return {
                        path: itemPath,
                        reason: "is missing; sparse arrays are not supported. Use null for an empty slot.",
                    };
                }

                let item: unknown;

                try {
                    item = (candidate as unknown[])[index];
                } catch (error) {
                    ancestors.delete(candidate);

                    return {
                        path: itemPath,
                        reason: `could not be read: ${describeThrownValue(error)}.`,
                    };
                }

                const issue = inspect(item, itemPath, ancestors);

                if (issue) {
                    ancestors.delete(candidate);
                    return issue;
                }
            }

            ancestors.delete(candidate);
            return undefined;
        }

        let keys: string[];

        try {
            keys = Object.keys(candidate);
        } catch (error) {
            ancestors.delete(candidate);

            return {
                path: currentPath,
                reason: `could not be inspected: ${describeThrownValue(error)}.`,
            };
        }

        for (const key of keys) {
            const propertyPath = appendPropertyPath(currentPath, key);
            let property: unknown;

            try {
                property = (candidate as Record<string, unknown>)[key];
            } catch (error) {
                ancestors.delete(candidate);

                return {
                    path: propertyPath,
                    reason: `could not be read: ${describeThrownValue(error)}.`,
                };
            }

            const issue = inspect(property, propertyPath, ancestors);

            if (issue) {
                ancestors.delete(candidate);
                return issue;
            }
        }

        ancestors.delete(candidate);
        return undefined;
    };

    return inspect(value, path, new Map());
};

export const validateInjectScriptArguments = (args: readonly unknown[] | undefined): void => {
    if (args === undefined) {
        return;
    }

    if (!Array.isArray(args)) {
        throw new InvalidInjectScriptArgumentsError("arguments must be an array.");
    }

    const issue = findJsonCompatibilityIssue(args, "arguments");

    if (issue) {
        throw new InvalidInjectScriptArgumentsError(`${issue.path} ${issue.reason}`);
    }
};

export const validateInjectScriptFiles = (files: string | NonEmptyReadonlyArray<string>): string[] => {
    const fileList = typeof files === "string" ? [files] : files;

    if (!Array.isArray(fileList) || fileList.length === 0) {
        throw new InvalidInjectScriptFilesError("at least one file is required.");
    }

    if (fileList.some(file => typeof file !== "string" || file.trim().length === 0)) {
        throw new InvalidInjectScriptFilesError("each file must be a non-empty string.");
    }

    return [...fileList];
};
