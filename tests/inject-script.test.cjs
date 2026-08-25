const {execFileSync} = require("node:child_process");
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join} = require("node:path");

const {
    default: injectScript,
    injectScript: namedInjectScript,
    InjectScriptBaseError,
    InjectScriptDeliveryError,
    InjectScriptTargetErrorKind,
    InjectScriptTimeoutError,
    InvalidInjectScriptArgumentsError,
    InvalidInjectScriptFilesError,
    InvalidInjectScriptOptionsError,
    InvalidInjectScriptTargetError,
    UnsupportedInjectScriptOptionError,
    UnsupportedInjectScriptTargetError,
} = require("../dist/index.cjs");

const executeGeneratedCode = (code, namespace) => {
    const directory = mkdtempSync(join(tmpdir(), "inject-script-test-"));
    const scriptPath = join(directory, "injected.cjs");
    const returnsPromise = namespace === "browser" ? "return Promise.resolve();" : "";

    writeFileSync(
        scriptPath,
        `globalThis.${namespace} = {
            runtime: {
                id: "test-extension",
                sendMessage(message, callback) {
                    if (callback !== undefined) {
                        throw new Error("Generated payload requested an unused response callback.");
                    }
                    process.stdout.write(JSON.stringify(message));
                    ${returnsPromise}
                }
            }
        };
        ${code}\n`
    );

    try {
        return JSON.parse(execFileSync(process.execPath, [scriptPath], {encoding: "utf8"}));
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
};

const createRuntime = manifestVersion => {
    const listeners = new Set();

    return {
        listeners,
        runtime: {
            id: "test-extension",
            lastError: undefined,
            getManifest: () => ({manifest_version: manifestVersion}),
            onMessage: {
                addListener: listener => listeners.add(listener),
                removeListener: listener => listeners.delete(listener),
            },
        },
    };
};

const getMessageType = code => {
    return code.match(/"(inject-script-[^"]+)"/)?.[1];
};

describe("package exports", () => {
    test("exports the factory as both default and named", () => {
        expect(namedInjectScript).toBe(injectScript);
    });
});

describe("InjectScript target API", () => {
    afterEach(() => {
        delete global.chrome;
        delete global.browser;
    });

    test.each([
        [{target: {tabId: -1}}, '"tabId" must be a non-negative integer'],
        [{target: {tabId: 1, allFrames: false}}, '"allFrames" must be exactly true'],
        [{target: {tabId: 1, frameIds: []}}, '"frameIds" must contain at least one'],
        [{target: {tabId: 1, frameIds: [1, 1]}}, '"frameIds" must not contain duplicate'],
        [{target: {tabId: 1, frameIds: [1.5]}}, "frame ID must be a non-negative integer"],
        [{target: {tabId: 1, documentIds: [""]}}, "document ID must be a non-empty string"],
        [{target: {tabId: 1, documentIds: ["doc", "doc"]}}, '"documentIds" must not contain duplicate'],
        [
            {target: {tabId: 1, allFrames: true, frameIds: [1]}},
            '"allFrames", "frameIds", and "documentIds" are mutually exclusive',
        ],
        [{target: {tabId: 1, frameId: 2}}, 'unknown field: "frameId"'],
    ])("rejects invalid target %#", (options, message) => {
        const {runtime} = createRuntime(3);
        global.chrome = {runtime};

        expect(() => injectScript(options)).toThrow(InvalidInjectScriptTargetError);
        expect(() => injectScript(options)).toThrow(message);
    });

    test("rejects invalid and unknown execution options", () => {
        const {runtime} = createRuntime(3);
        global.chrome = {runtime};

        expect(() => injectScript({target: {tabId: 1}, timeoutMs: 0})).toThrow(InvalidInjectScriptOptionsError);
        expect(() => injectScript({target: {tabId: 1}, unexpected: true})).toThrow(InvalidInjectScriptOptionsError);

        try {
            injectScript({target: {tabId: 1}, timeoutMs: 0});
        } catch (error) {
            expect(error).toBeInstanceOf(InjectScriptBaseError);
            expect(error.code).toBe("ERR_INJECT_SCRIPT_INVALID_OPTIONS");
        }
    });

    test("copies and atomically replaces targets", async () => {
        const {runtime} = createRuntime(3);
        const calls = [];
        const frameIds = [1];

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    calls.push(details);
                    callback([]);
                },
            },
        };

        const injector = injectScript({target: {tabId: 4, frameIds}});

        frameIds.push(2);
        injector.target({tabId: 4, allFrames: true});
        await injector.file("/content.js");

        expect(calls[0].target).toEqual({tabId: 4, allFrames: true});
    });

    test("keeps the previous target when replacement validation fails", async () => {
        const {runtime} = createRuntime(3);
        const calls = [];

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    calls.push(details);
                    callback([]);
                },
            },
        };

        const injector = injectScript({target: {tabId: 4, frameIds: [2]}});

        expect(() => injector.target({tabId: 4, frameIds: []})).toThrow(InvalidInjectScriptTargetError);

        await injector.file("/content.js");

        expect(calls[0].target).toEqual({tabId: 4, frameIds: [2]});
    });
});

describe("MV3 adapter", () => {
    afterEach(() => {
        delete global.chrome;
        delete global.browser;
    });

    test("runs explicit frame targets independently and preserves input order", async () => {
        const {runtime} = createRuntime(3);
        const calls = [];

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    calls.push(details);
                    const frameId = details.target.frameIds[0];
                    const result =
                        frameId === 8
                            ? {frameId, documentId: "doc-8", error: {name: "Error", message: "failed"}}
                            : frameId === 9
                              ? {frameId, documentId: "doc-9", error: undefined}
                              : frameId === 10
                                ? {frameId, documentId: "doc-10", result: "ok", error: undefined}
                                : frameId === 0
                                  ? {frameId, documentId: "doc-0", result: "top"}
                                  : {frameId, documentId: "doc-3", result: undefined};

                    callback([result]);
                },
            },
        };

        const results = await injectScript({
            target: {tabId: 5, frameIds: [8, 0, 3, 9, 10]},
            runAt: "document_start",
            world: "MAIN",
        }).run(() => "value");

        expect(calls.map(call => call.target)).toEqual([
            {tabId: 5, frameIds: [8]},
            {tabId: 5, frameIds: [0]},
            {tabId: 5, frameIds: [3]},
            {tabId: 5, frameIds: [9]},
            {tabId: 5, frameIds: [10]},
        ]);
        expect(calls.every(call => call.injectImmediately === true)).toBe(true);
        expect(results).toEqual([
            {
                target: {tabId: 5, frameId: 8, documentId: "doc-8"},
                success: false,
                error: {kind: InjectScriptTargetErrorKind.Execution, name: "Error", message: "failed"},
            },
            {target: {tabId: 5, frameId: 0, documentId: "doc-0"}, success: true, value: "top"},
            {
                target: {tabId: 5, frameId: 3, documentId: "doc-3"},
                success: false,
                error: expect.objectContaining({
                    kind: InjectScriptTargetErrorKind.Unobservable,
                    name: "Error",
                    message: "The browser did not expose an observable injected function result.",
                }),
            },
            {
                target: {tabId: 5, frameId: 9, documentId: "doc-9"},
                success: false,
                error: {kind: InjectScriptTargetErrorKind.Execution, name: "Error", message: "undefined"},
            },
            {target: {tabId: 5, frameId: 10, documentId: "doc-10"}, success: true, value: "ok"},
        ]);
    });

    test("starts every explicit frame call before awaiting and isolates a removed frame", async () => {
        const {runtime} = createRuntime(3);
        const calls = [];
        const callbacks = new Map();

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    const frameId = details.target.frameIds[0];
                    calls.push(frameId);
                    callbacks.set(frameId, callback);
                },
            },
        };

        const pending = injectScript({target: {tabId: 5, frameIds: [7, 2, 9]}}).run(() => "value");

        expect(calls).toEqual([7, 2, 9]);

        callbacks.get(9)([{frameId: 9, result: "nine"}]);
        global.chrome.runtime.lastError = {message: "No frame with id 2 in tab with id 5"};
        callbacks.get(2)();
        global.chrome.runtime.lastError = undefined;
        callbacks.get(7)([{frameId: 7, result: "seven"}]);

        await expect(pending).resolves.toEqual([
            {target: {tabId: 5, frameId: 7}, success: true, value: "seven"},
            {
                target: {tabId: 5, frameId: 2},
                success: false,
                error: expect.objectContaining({
                    kind: InjectScriptTargetErrorKind.TargetGone,
                    message: "No frame with id 2 in tab with id 5",
                }),
            },
            {target: {tabId: 5, frameId: 9}, success: true, value: "nine"},
        ]);
    });

    test("returns one failure for every unavailable explicit frame", async () => {
        const {runtime} = createRuntime(3);

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    const frameId = details.target.frameIds[0];
                    global.chrome.runtime.lastError = {message: `No frame with id ${frameId} in tab with id 5`};
                    callback();
                    global.chrome.runtime.lastError = undefined;
                },
            },
        };

        const results = await injectScript({target: {tabId: 5, frameIds: [4, 6]}}).run(() => "value");

        expect(results).toHaveLength(2);
        expect(results.map(result => result.target)).toEqual([
            {tabId: 5, frameId: 4},
            {tabId: 5, frameId: 6},
        ]);
        expect(
            results.every(result => !result.success && result.error.kind === InjectScriptTargetErrorKind.TargetGone)
        ).toBe(true);
    });

    test("runs document targets independently without inventing a frame ID for delivery failures", async () => {
        const {runtime} = createRuntime(3);
        const calls = [];

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    const documentId = details.target.documentIds[0];
                    calls.push(documentId);

                    if (documentId === "doc-b") {
                        global.chrome.runtime.lastError = {message: "No document with id doc-b"};
                        callback();
                        global.chrome.runtime.lastError = undefined;
                        return;
                    }

                    callback([{frameId: 7, documentId, result: "document-a"}]);
                },
            },
        };

        await expect(
            injectScript({target: {tabId: 5, documentIds: ["doc-a", "doc-b"]}}).run(() => "value")
        ).resolves.toEqual([
            {target: {tabId: 5, documentId: "doc-a", frameId: 7}, success: true, value: "document-a"},
            {
                target: {tabId: 5, documentId: "doc-b"},
                success: false,
                error: expect.objectContaining({kind: InjectScriptTargetErrorKind.TargetGone}),
            },
        ]);
        expect(calls).toEqual(["doc-a", "doc-b"]);
    });

    test("returns per-frame allFrames results and an operation failure when native delivery fails", async () => {
        const {runtime} = createRuntime(3);
        let failDelivery = false;

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (_details, callback) => {
                    if (failDelivery) {
                        global.chrome.runtime.lastError = {message: "Missing host permission"};
                        callback();
                        global.chrome.runtime.lastError = undefined;
                        return;
                    }

                    callback([
                        {frameId: 4, result: "child"},
                        {frameId: 0, result: "top"},
                    ]);
                },
            },
        };

        const injector = injectScript({target: {tabId: 5, allFrames: true}});

        await expect(injector.run(() => "value")).resolves.toEqual([
            {target: {tabId: 5, frameId: 0}, success: true, value: "top"},
            {target: {tabId: 5, frameId: 4}, success: true, value: "child"},
        ]);

        failDelivery = true;

        await expect(injector.run(() => "value")).resolves.toEqual([
            {
                target: {tabId: 5, allFrames: true},
                success: false,
                error: expect.objectContaining({kind: InjectScriptTargetErrorKind.Delivery}),
            },
        ]);
    });

    test("times out only the unresponsive explicit MV3 target", async () => {
        const {runtime} = createRuntime(3);

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    const frameId = details.target.frameIds[0];

                    if (frameId === 1) callback([{frameId, result: "one"}]);
                },
            },
        };

        await expect(
            injectScript({target: {tabId: 5, frameIds: [1, 2]}, timeoutMs: 5}).run(() => "value")
        ).resolves.toEqual([
            {target: {tabId: 5, frameId: 1}, success: true, value: "one"},
            {
                target: {tabId: 5, frameId: 2},
                success: false,
                error: expect.objectContaining({kind: InjectScriptTargetErrorKind.Timeout, timeoutMs: 5}),
            },
        ]);
    });

    test("validates every observable native result before fulfilling it", async () => {
        const {runtime} = createRuntime(3);
        const cyclic = {};
        cyclic.self = cyclic;

        const sparse = [];
        sparse.length = 1;

        const symbolKeyed = {};
        symbolKeyed[Symbol("metadata")] = true;

        const arrayWithMetadata = [];
        arrayWithMetadata.metadata = true;

        class CustomArray extends Array {}

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (_details, callback) => {
                    callback([
                        {frameId: 0, result: null},
                        {frameId: 1, result: true},
                        {frameId: 2, result: 42},
                        {frameId: 3, result: {nested: ["ok"]}},
                        {frameId: 4, result: new Date(0)},
                        {frameId: 5, result: new Map([["key", "value"]])},
                        {frameId: 6, result: Number.NaN},
                        {frameId: 7, result: cyclic},
                        {frameId: 8, result: sparse},
                        {frameId: 9, result: symbolKeyed},
                        {frameId: 10, result: arrayWithMetadata},
                        {frameId: 11, result: new CustomArray()},
                    ]);
                },
            },
        };

        const results = await injectScript({
            target: {tabId: 5, frameIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]},
        }).run(() => null);
        const byFrame = new Map(results.map(result => [result.target.frameId, result]));

        expect(results.slice(0, 4)).toEqual([
            {target: {tabId: 5, frameId: 0}, success: true, value: null},
            {target: {tabId: 5, frameId: 1}, success: true, value: true},
            {target: {tabId: 5, frameId: 2}, success: true, value: 42},
            {target: {tabId: 5, frameId: 3}, success: true, value: {nested: ["ok"]}},
        ]);
        expect(byFrame.get(4)).toMatchObject({
            success: false,
            error: {
                kind: InjectScriptTargetErrorKind.Execution,
                name: "TypeError",
                message: expect.stringContaining("result is a Date instance"),
            },
        });
        expect(byFrame.get(5)).toMatchObject({
            success: false,
            error: {
                kind: InjectScriptTargetErrorKind.Execution,
                message: expect.stringContaining("result is a Map instance"),
            },
        });
        expect(byFrame.get(6)).toMatchObject({
            success: false,
            error: {kind: InjectScriptTargetErrorKind.Execution, message: expect.stringContaining("result is NaN")},
        });
        expect(byFrame.get(7)).toMatchObject({
            success: false,
            error: {
                kind: InjectScriptTargetErrorKind.Execution,
                message: expect.stringContaining("result.self contains a circular reference"),
            },
        });
        expect(byFrame.get(8)).toMatchObject({
            success: false,
            error: {
                kind: InjectScriptTargetErrorKind.Execution,
                message: expect.stringContaining("result[0] is missing"),
            },
        });
        expect(byFrame.get(9)).toMatchObject({
            success: false,
            error: {
                kind: InjectScriptTargetErrorKind.Execution,
                message: expect.stringContaining("enumerable symbol-keyed property"),
            },
        });
        expect(byFrame.get(10)).toMatchObject({
            success: false,
            error: {
                kind: InjectScriptTargetErrorKind.Execution,
                message: expect.stringContaining("result.metadata is an additional array property"),
            },
        });
        expect(byFrame.get(11)).toMatchObject({
            success: false,
            error: {
                kind: InjectScriptTargetErrorKind.Execution,
                message: expect.stringContaining("result is a CustomArray instance"),
            },
        });
    });

    test("supports a Promise-based browser namespace", async () => {
        const {runtime} = createRuntime(3);
        const calls = [];

        global.browser = {
            runtime,
            scripting: {
                executeScript: details => {
                    calls.push(details);
                    return Promise.resolve([{frameId: 0, result: {namespace: "browser"}}]);
                },
            },
        };

        await expect(injectScript({target: {tabId: 12}}).run(() => "value")).resolves.toEqual([
            {
                target: {tabId: 12, frameId: 0},
                success: true,
                value: {namespace: "browser"},
            },
        ]);
        expect(calls).toHaveLength(1);
        expect(calls[0].target).toEqual({tabId: 12});
    });

    test("passes document targets directly without browser-name fallback", async () => {
        const {runtime} = createRuntime(3);
        const calls = [];

        global.chrome = {
            runtime: {...runtime, getBrowserInfo: () => Promise.resolve({name: "Firefox"})},
            scripting: {
                executeScript: (details, callback) => {
                    calls.push(details);
                    callback([]);
                },
            },
        };

        await injectScript({target: {tabId: 7, documentIds: ["doc"]}}).file("/content.js");

        expect(calls[0].target).toEqual({tabId: 7, documentIds: ["doc"]});
    });

    test.each([
        [{tabId: 7}, [{tabId: 7}], {tabId: 7}],
        [{tabId: 7, allFrames: true}, [{tabId: 7, allFrames: true}], {tabId: 7, allFrames: true}],
        [
            {tabId: 7, frameIds: [0, 2]},
            [
                {tabId: 7, frameIds: [0]},
                {tabId: 7, frameIds: [2]},
            ],
            {tabId: 7, frameIds: [0, 2]},
        ],
        [
            {tabId: 7, documentIds: ["doc-a", "doc-b"]},
            [
                {tabId: 7, documentIds: ["doc-a"]},
                {tabId: 7, documentIds: ["doc-b"]},
            ],
            {tabId: 7, documentIds: ["doc-a", "doc-b"]},
        ],
    ])("isolates explicit run targets while keeping file targets native %#", async (target, runTargets, fileTarget) => {
        const {runtime} = createRuntime(3);
        const calls = [];

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    calls.push(details.target);
                    callback(details.func ? [{frameId: 0, result: null}] : []);
                },
            },
        };

        const injector = injectScript({target});

        await injector.run(() => null);
        await injector.file("/content.js");

        expect(calls).toEqual([...runTargets, fileTarget]);
    });

    test("updates execution options without changing the target", async () => {
        const {runtime} = createRuntime(3);
        const calls = [];

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    calls.push(details);
                    callback([]);
                },
            },
        };

        const injector = injectScript({target: {tabId: 7, frameIds: [2]}, world: "ISOLATED"});

        injector.options({world: "MAIN", runAt: "document_start", timeoutMs: 50});
        await injector.file("/content.js");

        expect(calls[0]).toMatchObject({
            target: {tabId: 7, frameIds: [2]},
            world: "MAIN",
            injectImmediately: true,
        });
    });

    test.each([
        [() => "sync", "sync"],
        [async () => "async", "async"],
    ])("supports synchronous and asynchronous callbacks", async (func, expected) => {
        const {runtime} = createRuntime(3);

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (details, callback) => {
                    Promise.resolve(details.func(...(details.args ?? []))).then(result => {
                        callback([{frameId: 0, result}]);
                    });
                },
            },
        };

        await expect(injectScript({target: {tabId: 7}}).run(func)).resolves.toEqual([
            {target: {tabId: 7, frameId: 0}, success: true, value: expected},
        ]);
    });

    test.each([
        [{matchAboutBlank: true}, '"matchAboutBlank" is not supported'],
        [{runAt: "document_end"}, '"runAt: document_end" cannot be represented'],
    ])("rejects unsupported execution option %#", (execution, message) => {
        const {runtime} = createRuntime(3);
        global.chrome = {runtime};

        expect(() => injectScript({target: {tabId: 1}, ...execution})).toThrow(UnsupportedInjectScriptOptionError);
        expect(() => injectScript({target: {tabId: 1}, ...execution})).toThrow(message);
    });

    test("normalizes documentIds capability errors without falling back", async () => {
        const {runtime} = createRuntime(3);
        const nativeError = {message: 'Unexpected property "documentIds"'};

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (_details, callback) => {
                    global.chrome.runtime.lastError = nativeError;
                    callback();
                    global.chrome.runtime.lastError = undefined;
                },
            },
        };

        const rejection = injectScript({target: {tabId: 2, documentIds: ["doc"]}}).file("/file.js");

        await expect(rejection).rejects.toMatchObject({
            code: "ERR_INJECT_SCRIPT_UNSUPPORTED_TARGET",
            cause: expect.any(Error),
        });
        await expect(rejection).rejects.toThrow(UnsupportedInjectScriptTargetError);
    });

    test("normalizes unsupported native execution capabilities", async () => {
        const {runtime} = createRuntime(3);

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (_details, callback) => {
                    global.chrome.runtime.lastError = {message: "Unexpected property: world"};
                    callback();
                    global.chrome.runtime.lastError = undefined;
                },
            },
        };

        const rejection = injectScript({target: {tabId: 2}, world: "MAIN"}).file("/file.js");

        await expect(rejection).rejects.toMatchObject({
            code: "ERR_INJECT_SCRIPT_UNSUPPORTED_OPTION",
            cause: expect.any(Error),
        });
        await expect(rejection).rejects.toThrow(UnsupportedInjectScriptOptionError);
    });

    test("rejects delivery failures and timeouts with package errors", async () => {
        const {runtime} = createRuntime(3);

        global.chrome = {
            runtime,
            scripting: {
                executeScript: (_details, callback) => {
                    global.chrome.runtime.lastError = {message: "Missing host permission"};
                    callback();
                    global.chrome.runtime.lastError = undefined;
                },
            },
        };

        await expect(injectScript({target: {tabId: 2}}).file("/file.js")).rejects.toThrow(InjectScriptDeliveryError);

        global.chrome.scripting.executeScript = () => {};

        await expect(injectScript({target: {tabId: 2}, timeoutMs: 5}).file("/file.js")).rejects.toThrow(
            InjectScriptTimeoutError
        );
    });

    test("returns a structured target timeout from run()", async () => {
        const {runtime} = createRuntime(3);

        global.chrome = {
            runtime,
            scripting: {
                executeScript: () => {},
            },
        };

        await expect(injectScript({target: {tabId: 2}, timeoutMs: 5}).run(() => "late")).resolves.toEqual([
            {
                target: {tabId: 2, frameId: 0},
                success: false,
                error: expect.objectContaining({
                    kind: InjectScriptTargetErrorKind.Timeout,
                    name: "InjectScriptTimeoutError",
                    timeoutMs: 5,
                }),
            },
        ]);
    });
});

describe("MV2 adapter", () => {
    afterEach(() => {
        delete global.chrome;
        delete global.browser;
    });

    test("collects all-frame responses without webNavigation and ignores duplicates", async () => {
        const {runtime, listeners} = createRuntime(2);
        const calls = [];

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (tabId, details, callback) => {
                    calls.push({tabId, details});

                    const type = getMessageType(details.code);

                    queueMicrotask(() => {
                        for (const listener of listeners) {
                            listener(
                                {type, data: {status: "fulfilled", result: "child"}},
                                {tab: {id: tabId}, frameId: 4}
                            );
                            listener(
                                {type, data: {status: "fulfilled", result: "duplicate"}},
                                {tab: {id: tabId}, frameId: 4}
                            );
                            listener(
                                {type, data: {status: "fulfilled", result: "wrong tab"}},
                                {tab: {id: 999}, frameId: 0}
                            );
                            listener(
                                {type, data: {status: "rejected", error: {name: "Error", message: "top failed"}}},
                                {tab: {id: tabId}, frameId: 0}
                            );
                        }
                    });

                    callback([undefined, undefined]);
                },
            },
        };

        const results = await injectScript({target: {tabId: 3, allFrames: true}}).run(() => "value");

        expect(calls).toHaveLength(1);
        expect(calls[0].details.allFrames).toBe(true);
        expect(calls[0].details.matchAboutBlank).toBeUndefined();
        expect(global.chrome.webNavigation).toBeUndefined();
        expect(results).toEqual([
            {
                target: {tabId: 3, frameId: 0},
                success: false,
                error: {
                    kind: InjectScriptTargetErrorKind.Execution,
                    name: "Error",
                    message: "top failed",
                },
            },
            {target: {tabId: 3, frameId: 4}, success: true, value: "child"},
        ]);
        expect(listeners.size).toBe(0);
    });

    test("preserves frame zero and injects each explicit frame", async () => {
        const {runtime, listeners} = createRuntime(2);
        const frameCalls = [];

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (tabId, details, callback) => {
                    frameCalls.push(details.frameId);
                    const type = getMessageType(details.code);

                    queueMicrotask(() => {
                        for (const listener of listeners) {
                            listener(
                                {type, data: {status: "fulfilled", result: details.frameId}},
                                {tab: {id: tabId}, frameId: details.frameId}
                            );
                        }
                    });

                    callback([undefined]);
                },
            },
        };

        const results = await injectScript({target: {tabId: 6, frameIds: [2, 0]}}).run(() => 1);

        expect(frameCalls).toEqual([2, 0]);
        expect(results.map(result => result.target.frameId)).toEqual([2, 0]);
    });

    test("uses one temporary listener for an explicit frame batch", async () => {
        jest.useFakeTimers();

        try {
            const {runtime, listeners} = createRuntime(2);
            const frameIds = Array.from({length: 20}, (_, frameId) => frameId);
            const frameCalls = [];

            global.chrome = {
                runtime,
                tabs: {
                    executeScript: (_tabId, details, callback) => {
                        frameCalls.push(details.frameId);
                        callback([undefined]);
                    },
                },
            };

            const pending = injectScript({target: {tabId: 6, frameIds}, timeoutMs: 10}).run(() => "value");

            expect(frameCalls).toEqual(frameIds);
            expect(listeners.size).toBe(1);
            expect(jest.getTimerCount()).toBe(20);

            jest.advanceTimersByTime(10);

            const results = await pending;

            expect(results).toHaveLength(20);
            expect(
                results.every(result => !result.success && result.error.kind === InjectScriptTargetErrorKind.Timeout)
            ).toBe(true);
            expect(listeners.size).toBe(0);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test("dispatches explicit responses by request and isolates parallel batches", async () => {
        const {runtime, listeners} = createRuntime(2);
        const calls = [];

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (tabId, details, callback) => {
                    calls.push({tabId, frameId: details.frameId, type: getMessageType(details.code)});
                    callback([undefined]);
                },
            },
        };

        const first = injectScript({target: {tabId: 6, frameIds: [2, 0]}}).run(() => "first");
        const second = injectScript({target: {tabId: 7, frameIds: [4, 1]}}).run(() => "second");

        expect(listeners.size).toBe(2);

        const dispatch = (type, tabId, frameId, result) => {
            for (const listener of [...listeners]) {
                listener({type, data: {status: "fulfilled", result}}, {tab: {id: tabId}, frameId});
            }
        };

        dispatch("unrelated-message", 6, 2, "ignored");
        dispatch(calls.find(call => call.tabId === 6 && call.frameId === 2).type, 6, 99, "wrong frame");

        dispatch(calls.find(call => call.tabId === 7 && call.frameId === 1).type, 7, 1, "second-1");
        dispatch(calls.find(call => call.tabId === 6 && call.frameId === 0).type, 6, 0, "first-0");
        dispatch(calls.find(call => call.tabId === 7 && call.frameId === 4).type, 7, 4, "second-4");
        dispatch(calls.find(call => call.tabId === 6 && call.frameId === 2).type, 6, 2, "first-2");

        await expect(first).resolves.toEqual([
            {target: {tabId: 6, frameId: 2}, success: true, value: "first-2"},
            {target: {tabId: 6, frameId: 0}, success: true, value: "first-0"},
        ]);
        await expect(second).resolves.toEqual([
            {target: {tabId: 7, frameId: 4}, success: true, value: "second-4"},
            {target: {tabId: 7, frameId: 1}, success: true, value: "second-1"},
        ]);
        expect(listeners.size).toBe(0);
    });

    test("collects fulfilled and rejected outcomes from explicit frames", async () => {
        const {runtime, listeners} = createRuntime(2);

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (tabId, details, callback) => {
                    const type = getMessageType(details.code);

                    queueMicrotask(() => {
                        for (const listener of listeners) {
                            listener(
                                details.frameId === 2
                                    ? {type, data: {status: "rejected", error: {name: "Error", message: "failed"}}}
                                    : {type, data: {status: "fulfilled", result: "top"}},
                                {tab: {id: tabId}, frameId: details.frameId}
                            );
                        }
                    });

                    callback([undefined]);
                },
            },
        };

        await expect(injectScript({target: {tabId: 6, frameIds: [2, 0]}}).run(() => "value")).resolves.toEqual([
            {
                target: {tabId: 6, frameId: 2},
                success: false,
                error: {
                    kind: InjectScriptTargetErrorKind.Execution,
                    name: "Error",
                    message: "failed",
                },
            },
            {target: {tabId: 6, frameId: 0}, success: true, value: "top"},
        ]);
    });

    test("keeps successful MV2 frames when another native delivery fails", async () => {
        const {runtime, listeners} = createRuntime(2);
        const frameCalls = [];

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (tabId, details, callback) => {
                    frameCalls.push(details.frameId);

                    if (details.frameId === 2) {
                        global.chrome.runtime.lastError = {message: "No frame with id 2 in tab with id 6"};
                        callback();
                        global.chrome.runtime.lastError = undefined;
                        return;
                    }

                    const type = getMessageType(details.code);

                    queueMicrotask(() => {
                        for (const listener of listeners) {
                            listener(
                                {type, data: {status: "fulfilled", result: "top"}},
                                {tab: {id: tabId}, frameId: details.frameId}
                            );
                        }
                    });
                    callback([undefined]);
                },
            },
        };

        const pending = injectScript({target: {tabId: 6, frameIds: [2, 0]}}).run(() => "value");

        expect(frameCalls).toEqual([2, 0]);
        await expect(pending).resolves.toEqual([
            {
                target: {tabId: 6, frameId: 2},
                success: false,
                error: expect.objectContaining({kind: InjectScriptTargetErrorKind.TargetGone}),
            },
            {target: {tabId: 6, frameId: 0}, success: true, value: "top"},
        ]);
    });

    test.each([
        [
            "chrome",
            async value => ({value}),
            ["async"],
            {target: {tabId: 8, frameId: 0}, success: true, value: {value: "async"}},
        ],
        [
            "browser",
            () => {
                throw new Error("frame failed");
            },
            [],
            {
                target: {tabId: 8, frameId: 0},
                success: false,
                error: expect.objectContaining({name: "Error", message: "frame failed"}),
            },
        ],
        [
            "chrome",
            () => new Date(0),
            [],
            {
                target: {tabId: 8, frameId: 0},
                success: false,
                error: expect.objectContaining({
                    name: "TypeError",
                    message:
                        "Injected function result is not JSON-compatible: result is a Date instance; pass a plain object.",
                }),
            },
        ],
        [
            "chrome",
            () => ({settings: {limit: undefined}}),
            [],
            {
                target: {tabId: 8, frameId: 0},
                success: false,
                error: expect.objectContaining({
                    name: "TypeError",
                    message:
                        "Injected function result is not JSON-compatible: result.settings.limit is undefined; JSON has no undefined value. Omit the key or use null.",
                }),
            },
        ],
        [
            "chrome",
            () => undefined,
            [],
            {
                target: {tabId: 8, frameId: 0},
                success: false,
                error: expect.objectContaining({
                    name: "TypeError",
                    message:
                        "Injected function result is not JSON-compatible: result is undefined; JSON has no undefined value. Omit the key or use null.",
                }),
            },
        ],
    ])("executes the generated payload through the %s namespace", async (namespace, func, args, expected) => {
        const {runtime, listeners} = createRuntime(2);

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (tabId, details, callback) => {
                    const message = executeGeneratedCode(details.code, namespace);

                    for (const listener of listeners) {
                        listener(message, {tab: {id: tabId}, frameId: 0});
                    }

                    callback([undefined]);
                },
            },
        };

        await expect(injectScript({target: {tabId: 8}}).run(func, args)).resolves.toEqual([expected]);
    });

    test("supports Promise-based native delivery through the browser namespace", async () => {
        const {runtime, listeners} = createRuntime(2);

        global.browser = {
            runtime,
            tabs: {
                executeScript: (tabId, details) => {
                    const type = getMessageType(details.code);

                    queueMicrotask(() => {
                        for (const listener of listeners) {
                            listener(
                                {type, data: {status: "fulfilled", result: {namespace: "browser"}}},
                                {tab: {id: tabId}, frameId: 0}
                            );
                        }
                    });

                    return Promise.resolve([undefined]);
                },
            },
        };

        await expect(injectScript({target: {tabId: 12}}).run(() => "value")).resolves.toEqual([
            {
                target: {tabId: 12, frameId: 0},
                success: true,
                value: {namespace: "browser"},
            },
        ]);
    });

    test("cleans up the listener and timer after success", async () => {
        jest.useFakeTimers();

        try {
            const {runtime, listeners} = createRuntime(2);

            global.chrome = {
                runtime,
                tabs: {
                    executeScript: (tabId, details, callback) => {
                        const type = getMessageType(details.code);

                        for (const listener of listeners) {
                            listener({type, data: {status: "fulfilled", result: null}}, {tab: {id: tabId}, frameId: 0});
                        }

                        callback([undefined]);
                    },
                },
            };

            await expect(injectScript({target: {tabId: 1}}).run(() => null)).resolves.toHaveLength(1);

            expect(listeners.size).toBe(0);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test("injects files in order", async () => {
        const {runtime} = createRuntime(2);
        const files = [];

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (_tabId, details, callback) => {
                    files.push(details.file);
                    callback([undefined]);
                },
            },
        };

        await injectScript({target: {tabId: 1}}).file(["/first.js", "/second.js"]);

        expect(files).toEqual(["/first.js", "/second.js"]);
    });

    test("passes explicit MV2 execution options without changing native isolated-world behavior", async () => {
        const {runtime} = createRuntime(2);
        const calls = [];

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (_tabId, details, callback) => {
                    calls.push(details);
                    callback([undefined]);
                },
            },
        };

        await injectScript({
            target: {tabId: 1},
            matchAboutBlank: true,
            runAt: "document_start",
            world: "ISOLATED",
        }).file("/content.js");

        expect(calls[0]).toMatchObject({
            file: "/content.js",
            matchAboutBlank: true,
            runAt: "document_start",
        });
        expect(calls[0].world).toBeUndefined();
    });

    test("does not start later files after a timeout", async () => {
        jest.useFakeTimers();

        try {
            const {runtime} = createRuntime(2);
            const files = [];
            let finishFirst;

            global.chrome = {
                runtime,
                tabs: {
                    executeScript: (_tabId, details, callback) => {
                        files.push(details.file);
                        finishFirst = () => callback([undefined]);
                    },
                },
            };

            const pending = injectScript({target: {tabId: 1}, timeoutMs: 10}).file(["/first.js", "/second.js"]);
            const rejection = expect(pending).rejects.toThrow(InjectScriptTimeoutError);

            jest.advanceTimersByTime(10);
            await rejection;

            finishFirst();
            await Promise.resolve();
            await Promise.resolve();

            expect(files).toEqual(["/first.js"]);
        } finally {
            jest.useRealTimers();
        }
    });

    test("rejects unsupported targets and options before injection", () => {
        const {runtime} = createRuntime(2);
        global.chrome = {runtime};

        expect(() => injectScript({target: {tabId: 1, documentIds: ["doc"]}})).toThrow(
            UnsupportedInjectScriptTargetError
        );
        expect(() => injectScript({target: {tabId: 1}, world: "MAIN"})).toThrow(UnsupportedInjectScriptOptionError);
    });

    test("rejects invalid input before injection and returns a timeout for a missing response", async () => {
        const {runtime} = createRuntime(2);

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (_tabId, _details, callback) => callback([undefined]),
            },
        };

        const injector = injectScript({target: {tabId: 1}, timeoutMs: 5});

        await expect(injector.run(value => value, [new Date()])).rejects.toThrow(InvalidInjectScriptArgumentsError);
        await expect(injector.run(value => value, [{value: undefined}])).rejects.toThrow(
            InvalidInjectScriptArgumentsError
        );

        const cyclic = {};
        cyclic.self = cyclic;

        await expect(injector.run(value => value, [cyclic])).rejects.toThrow(InvalidInjectScriptArgumentsError);
        await expect(injector.file([])).rejects.toThrow(InvalidInjectScriptFilesError);
        await expect(injector.run(() => "never delivered")).resolves.toEqual([
            {
                target: {tabId: 1, frameId: 0},
                success: false,
                error: expect.objectContaining({
                    kind: InjectScriptTargetErrorKind.Timeout,
                    name: "InjectScriptTimeoutError",
                    timeoutMs: 5,
                }),
            },
        ]);
    });

    test("reports the exact path and reason for incompatible arguments", async () => {
        const {runtime} = createRuntime(2);

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (_tabId, _details, callback) => callback([undefined]),
            },
        };

        class Dto {
            constructor(id) {
                this.id = id;
            }
        }

        const cyclic = {};
        cyclic.self = cyclic;

        const sparse = [];
        sparse.length = 1;

        const unreadable = Object.defineProperty({}, "limit", {
            enumerable: true,
            get() {
                throw new Error("getter failed");
            },
        });

        const symbolKeyed = {};
        symbolKeyed[Symbol("metadata")] = true;

        const arrayWithMetadata = [];
        arrayWithMetadata.metadata = true;

        class CustomArray extends Array {}

        const injector = injectScript({target: {tabId: 1}});

        await expect(injector.run(value => value, [{limit: undefined}])).rejects.toThrow(
            "Invalid InjectScript arguments: arguments[0].limit is undefined; JSON has no undefined value. Omit the key or use null."
        );
        await expect(injector.run(value => value, [new Dto(1)])).rejects.toThrow(
            "Invalid InjectScript arguments: arguments[0] is a Dto instance; pass a plain object."
        );
        await expect(injector.run(value => value, [{limit: Number.NaN}])).rejects.toThrow(
            "Invalid InjectScript arguments: arguments[0].limit is NaN; JSON supports only finite numbers."
        );
        await expect(injector.run(value => value, [sparse])).rejects.toThrow(
            "Invalid InjectScript arguments: arguments[0][0] is missing; sparse arrays are not supported. Use null for an empty slot."
        );
        await expect(injector.run(value => value, [cyclic])).rejects.toThrow(
            "Invalid InjectScript arguments: arguments[0].self contains a circular reference to arguments[0]."
        );
        await expect(injector.run(value => value, [unreadable])).rejects.toThrow(
            "Invalid InjectScript arguments: arguments[0].limit could not be read: getter failed."
        );
        await expect(injector.run(value => value, [symbolKeyed])).rejects.toThrow(
            "Invalid InjectScript arguments: arguments[0] has an enumerable symbol-keyed property (Symbol(metadata)); JSON supports only string property keys."
        );
        await expect(injector.run(value => value, [arrayWithMetadata])).rejects.toThrow(
            "Invalid InjectScript arguments: arguments[0].metadata is an additional array property; JSON serializes only indexed array elements."
        );
        await expect(injector.run(value => value, [new CustomArray()])).rejects.toThrow(
            "Invalid InjectScript arguments: arguments[0] is a CustomArray instance; pass a plain array."
        );
    });

    test("preserves known frame results and times out only the missing explicit frame", async () => {
        const {runtime, listeners} = createRuntime(2);

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (tabId, details, callback) => {
                    const type = getMessageType(details.code);

                    if (details.frameId === 0) {
                        queueMicrotask(() => {
                            for (const listener of listeners) {
                                listener(
                                    {type, data: {status: "fulfilled", result: "top"}},
                                    {tab: {id: tabId}, frameId: 0}
                                );
                            }
                        });
                    }

                    callback([undefined]);
                },
            },
        };

        await expect(
            injectScript({target: {tabId: 1, frameIds: [2, 0]}, timeoutMs: 5}).run(() => "value")
        ).resolves.toEqual([
            {
                target: {tabId: 1, frameId: 2},
                success: false,
                error: expect.objectContaining({
                    kind: InjectScriptTargetErrorKind.Timeout,
                    name: "InjectScriptTimeoutError",
                    timeoutMs: 5,
                }),
            },
            {target: {tabId: 1, frameId: 0}, success: true, value: "top"},
        ]);
    });

    test("reports all-frame timeout details without discarding partial results", async () => {
        const {runtime, listeners} = createRuntime(2);

        global.chrome = {
            runtime,
            tabs: {
                executeScript: (tabId, details, callback) => {
                    const type = getMessageType(details.code);

                    queueMicrotask(() => {
                        for (const listener of listeners) {
                            listener(
                                {type, data: {status: "fulfilled", result: "top"}},
                                {tab: {id: tabId}, frameId: 0}
                            );
                        }
                    });

                    callback([undefined, undefined]);
                },
            },
        };

        await expect(
            injectScript({target: {tabId: 1, allFrames: true}, timeoutMs: 5}).run(() => "value")
        ).resolves.toEqual([
            {target: {tabId: 1, frameId: 0}, success: true, value: "top"},
            {
                target: {tabId: 1, allFrames: true},
                success: false,
                error: expect.objectContaining({
                    kind: InjectScriptTargetErrorKind.Timeout,
                    name: "InjectScriptTimeoutError",
                    timeoutMs: 5,
                    missingCount: 1,
                }),
            },
        ]);
    });

    test("cleans up listeners and timers after delivery errors and timeouts", async () => {
        jest.useFakeTimers();

        try {
            const {runtime, listeners} = createRuntime(2);

            global.chrome = {
                runtime,
                tabs: {
                    executeScript: (_tabId, _details, callback) => {
                        global.chrome.runtime.lastError = {message: "Missing host permission"};
                        callback();
                        global.chrome.runtime.lastError = undefined;
                    },
                },
            };

            await expect(injectScript({target: {tabId: 1}}).run(() => null)).resolves.toEqual([
                {
                    target: {tabId: 1, frameId: 0},
                    success: false,
                    error: expect.objectContaining({kind: InjectScriptTargetErrorKind.Delivery}),
                },
            ]);
            expect(listeners.size).toBe(0);
            expect(jest.getTimerCount()).toBe(0);

            global.chrome.tabs.executeScript = () => {};

            const pending = injectScript({target: {tabId: 1}, timeoutMs: 10}).run(() => null);
            const result = expect(pending).resolves.toEqual([
                {
                    target: {tabId: 1, frameId: 0},
                    success: false,
                    error: expect.objectContaining({kind: InjectScriptTargetErrorKind.Timeout}),
                },
            ]);

            expect(listeners.size).toBe(1);
            jest.advanceTimersByTime(10);
            await result;

            expect(listeners.size).toBe(0);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });
});
