let sequence = 0;

const randomPart = (): string => {
    if (typeof globalThis.crypto?.getRandomValues === "function") {
        const values = new Uint32Array(2);

        globalThis.crypto.getRandomValues(values);

        return Array.from(values, value => value.toString(36)).join("");
    }

    return Math.random().toString(36).slice(2);
};

export const createRequestId = (): string => {
    sequence = sequence >= Number.MAX_SAFE_INTEGER ? 1 : sequence + 1;

    return `inject-script-${Date.now().toString(36)}-${sequence.toString(36)}-${randomPart()}`;
};
