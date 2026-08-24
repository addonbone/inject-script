import {InjectScriptDeliveryError, InjectScriptTimeoutError} from "./errors";
import {
    validateInjectScriptArguments,
    validateInjectScriptExecutionOptions,
    validateInjectScriptFiles,
    validateInjectScriptOptions,
    validateInjectScriptTarget,
} from "./validation";
import type {
    InjectScriptContract,
    InjectScriptExecutionOptions,
    InjectScriptOptions,
    InjectScriptResult,
    InjectScriptTarget,
    NonEmptyReadonlyArray,
} from "./types";

const DEFAULT_TIMEOUT_MS = 4_000;

export default abstract class implements InjectScriptContract {
    protected _target: InjectScriptTarget;
    protected _execution: InjectScriptExecutionOptions;

    public constructor(options: InjectScriptOptions) {
        const normalized = validateInjectScriptOptions(options);

        this._target = normalized.target;
        this._execution = normalized.execution;
    }

    public target(target: InjectScriptTarget): this {
        const normalizedTarget = validateInjectScriptTarget(target);

        this.assertAdapterSupport(normalizedTarget, this._execution);
        this._target = normalizedTarget;

        return this;
    }

    public options(options: Partial<InjectScriptExecutionOptions>): this {
        const normalizedOptions = validateInjectScriptExecutionOptions(options);
        const nextExecution = {...this._execution, ...normalizedOptions};

        this.assertAdapterSupport(this._target, nextExecution);
        this._execution = nextExecution;

        return this;
    }

    public abstract run<A extends readonly unknown[], R>(
        func: (...args: A) => R,
        args?: A
    ): Promise<InjectScriptResult<Awaited<R>>[]>;

    public abstract file(files: string | NonEmptyReadonlyArray<string>): Promise<void>;

    protected abstract assertAdapterSupport(target: InjectScriptTarget, execution: InjectScriptExecutionOptions): void;

    protected validateArguments(args: readonly unknown[] | undefined): void {
        validateInjectScriptArguments(args);
    }

    protected normalizeFiles(files: string | NonEmptyReadonlyArray<string>): string[] {
        return validateInjectScriptFiles(files);
    }

    protected snapshotTarget(): InjectScriptTarget {
        return validateInjectScriptTarget(this._target);
    }

    protected snapshotExecution(): InjectScriptExecutionOptions {
        return {...this._execution};
    }

    protected get timeoutMs(): number {
        return this._execution.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    protected async withTimeout<T>(task: Promise<T>, target: InjectScriptTarget, timeoutMs: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let settled = false;

            const finish = (callback: () => void): void => {
                if (settled) return;

                settled = true;
                clearTimeout(timeoutId);
                callback();
            };

            const timeoutId = setTimeout(() => {
                finish(() => reject(new InjectScriptTimeoutError(target, timeoutMs)));
            }, timeoutMs);

            task.then(
                value => finish(() => resolve(value)),
                error => finish(() => reject(error))
            );
        });
    }

    protected deliveryError(target: InjectScriptTarget, error: unknown): Error {
        if (error instanceof InjectScriptDeliveryError || error instanceof InjectScriptTimeoutError) {
            return error;
        }

        return new InjectScriptDeliveryError(target, error);
    }
}
