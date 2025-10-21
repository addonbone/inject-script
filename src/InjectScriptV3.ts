import {browser, executeScript} from "@addon-core/browser";
import AbstractInjectScript from "./AbstractInjectScript";

type Awaited<T> = chrome.scripting.Awaited<T>;
type InjectionTarget = chrome.scripting.InjectionTarget;
type InjectionResult<T> = chrome.scripting.InjectionResult<T>;

export default class extends AbstractInjectScript {
    public async run<A extends any[], R>(func: (...args: A) => R, args?: A): Promise<InjectionResult<Awaited<R>>[]> {
        return executeScript({
            target: this.target(),
            world: this._options.world,
            injectImmediately: this.injectImmediately,
            func,
            args,
        });
    }

    public async file(fileList: string | string[]): Promise<void> {
        await executeScript({
            target: this.target(),
            world: this._options.world,
            injectImmediately: this.injectImmediately,
            files: typeof fileList === "string" ? [fileList] : fileList,
        });
    }

    protected target(): InjectionTarget {
        const target = {tabId: this._options.tabId};

        if (this.frameIds && this.frameIds.length > 0) {
            return {...target, frameIds: this.frameIds};
        }

        if (this.allFrames === true) {
            return {...target, allFrames: true};
        }

        // Firefox does not support `documentIds` in the target
        // getBrowserInfo is only available in firefox
        let isFirefox = false;
        try {
            // @ts-expect-error
            isFirefox = !!browser().runtime.getBrowserInfo;
        } catch (_e) {}

        if (!isFirefox) {
            const documentIds = this.documentIds;

            if (documentIds && documentIds.length > 0) {
                return {...target, documentIds};
            }
        }

        return target;
    }

    protected get documentIds(): string[] | undefined {
        const {documentId} = this._options;

        return typeof documentId === "string" ? [documentId] : documentId;
    }

    protected get injectImmediately(): boolean {
        return this._options.runAt === "document_start";
    }
}
