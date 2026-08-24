import injectScript, {
    type InjectScriptErrorCode,
    type InjectScriptResult,
    type InjectScriptTimeoutDetails,
    type JsonValue,
    injectScript as namedInjectScript,
    type SerializedInjectScriptError,
} from "../src/index";

declare const tabId: number;
declare const frameId: number;
declare const documentId: string;

const topFrame = injectScript({target: {tabId}});

namedInjectScript({target: {tabId}});

injectScript({target: {tabId, allFrames: true}});
injectScript({target: {tabId, frameIds: [0, frameId]}});
injectScript({target: {tabId, documentIds: [documentId]}});

// @ts-expect-error selectors are mutually exclusive
injectScript({target: {tabId, allFrames: true, frameIds: [frameId]}});

// @ts-expect-error selectors are mutually exclusive
injectScript({target: {tabId, frameIds: [frameId], documentIds: [documentId]}});

// @ts-expect-error explicit frame targets must not be empty
injectScript({target: {tabId, frameIds: []}});

// @ts-expect-error explicit document targets must not be empty
injectScript({target: {tabId, documentIds: []}});

// @ts-expect-error allFrames only accepts literal true
injectScript({target: {tabId, allFrames: false}});

topFrame.run(() => document.title);
topFrame.run(() => document.title, []);
topFrame.run((selector: string) => document.querySelector(selector)?.textContent ?? null, [".title"]);
topFrame.run(async (value: JsonValue) => ({value}), ["serializable"]);

interface Product {
    id: number;
    title: string;
}

interface ProductQuery {
    limit?: number;
    product: Product;
}

declare const product: Product;
declare const query: ProductQuery;

topFrame.run((): Product => ({id: 1, title: "product"}));
topFrame.run(async (): Promise<Product> => ({id: 1, title: "product"}));
topFrame.run((value: Product) => value.id, [product]);
topFrame.run((value: ProductQuery) => value.product, [query]);
topFrame.run((): never => {
    throw new Error("frame failed");
});

// @ts-expect-error required callback arguments must be provided
topFrame.run((selector: string) => document.querySelector(selector)?.textContent ?? null);

// @ts-expect-error callback arguments must be JSON-compatible
topFrame.run((value: JsonValue) => value, [new Date()]);

// @ts-expect-error callback results must be JSON-compatible
topFrame.run(() => document.body);

declare const result: InjectScriptResult<string>;

if (result.status === "fulfilled") {
    result.result.toUpperCase();
}

if (result.status === "rejected") {
    result.error.message.toUpperCase();
}

if (result.status === "unknown") {
    // @ts-expect-error unknown outcomes intentionally expose no result
    result.result;
}

declare const serializedError: SerializedInjectScriptError;
declare const errorCode: InjectScriptErrorCode;
declare const timeoutDetails: InjectScriptTimeoutDetails;

serializedError.message.toUpperCase();
errorCode.toUpperCase();
timeoutDetails.partialResults?.map(item => item.status);
