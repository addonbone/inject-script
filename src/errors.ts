import type {InjectScriptTarget} from "./types";

export type InjectScriptErrorCode =
    | "ERR_INJECT_SCRIPT_DELIVERY"
    | "ERR_INJECT_SCRIPT_INVALID_ARGUMENTS"
    | "ERR_INJECT_SCRIPT_INVALID_FILES"
    | "ERR_INJECT_SCRIPT_INVALID_OPTIONS"
    | "ERR_INJECT_SCRIPT_INVALID_TARGET"
    | "ERR_INJECT_SCRIPT_TIMEOUT"
    | "ERR_INJECT_SCRIPT_UNSUPPORTED_OPTION"
    | "ERR_INJECT_SCRIPT_UNSUPPORTED_TARGET";

export class InjectScriptBaseError extends Error {
    public readonly code: InjectScriptErrorCode;
    public override readonly cause?: unknown;

    protected constructor(name: string, code: InjectScriptErrorCode, message: string, cause?: unknown) {
        super(message);
        this.name = name;
        this.code = code;

        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}

export class InvalidInjectScriptTargetError extends InjectScriptBaseError {
    public constructor(message: string) {
        super(
            "InvalidInjectScriptTargetError",
            "ERR_INJECT_SCRIPT_INVALID_TARGET",
            `Invalid InjectScript target: ${message}`
        );
    }
}

export class UnsupportedInjectScriptTargetError extends InjectScriptBaseError {
    public constructor(message: string, cause?: unknown) {
        super(
            "UnsupportedInjectScriptTargetError",
            "ERR_INJECT_SCRIPT_UNSUPPORTED_TARGET",
            `Unsupported InjectScript target: ${message}`,
            cause
        );
    }
}

export class InvalidInjectScriptOptionsError extends InjectScriptBaseError {
    public constructor(message: string) {
        super(
            "InvalidInjectScriptOptionsError",
            "ERR_INJECT_SCRIPT_INVALID_OPTIONS",
            `Invalid InjectScript options: ${message}`
        );
    }
}

export class UnsupportedInjectScriptOptionError extends InjectScriptBaseError {
    public constructor(message: string, cause?: unknown) {
        super(
            "UnsupportedInjectScriptOptionError",
            "ERR_INJECT_SCRIPT_UNSUPPORTED_OPTION",
            `Unsupported InjectScript option: ${message}`,
            cause
        );
    }
}

export class InvalidInjectScriptArgumentsError extends InjectScriptBaseError {
    public constructor(message: string) {
        super(
            "InvalidInjectScriptArgumentsError",
            "ERR_INJECT_SCRIPT_INVALID_ARGUMENTS",
            `Invalid InjectScript arguments: ${message}`
        );
    }
}

export class InvalidInjectScriptFilesError extends InjectScriptBaseError {
    public constructor(message: string) {
        super(
            "InvalidInjectScriptFilesError",
            "ERR_INJECT_SCRIPT_INVALID_FILES",
            `Invalid InjectScript files: ${message}`
        );
    }
}

export class InjectScriptTimeoutError extends InjectScriptBaseError {
    public readonly target: InjectScriptTarget;
    public readonly timeoutMs: number;

    public constructor(target: InjectScriptTarget, timeoutMs: number) {
        super(
            "InjectScriptTimeoutError",
            "ERR_INJECT_SCRIPT_TIMEOUT",
            `Script execution timed out after ${timeoutMs} ms.`
        );
        this.target = target;
        this.timeoutMs = timeoutMs;
    }
}

export class InjectScriptDeliveryError extends InjectScriptBaseError {
    public readonly target: InjectScriptTarget;

    public constructor(target: InjectScriptTarget, cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);

        super("InjectScriptDeliveryError", "ERR_INJECT_SCRIPT_DELIVERY", `Script injection failed: ${message}`, cause);
        this.target = target;
    }
}
