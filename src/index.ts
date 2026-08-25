import {isManifestVersion3} from "@addon-core/browser";
import InjectScriptV2 from "./InjectScriptV2";
import InjectScriptV3 from "./InjectScriptV3";
import type {InjectScriptContract, InjectScriptOptions} from "./types";

export {
    InjectScriptBaseError,
    InjectScriptDeliveryError,
    InjectScriptTimeoutError,
    InvalidInjectScriptArgumentsError,
    InvalidInjectScriptFilesError,
    InvalidInjectScriptOptionsError,
    InvalidInjectScriptTargetError,
    UnsupportedInjectScriptOptionError,
    UnsupportedInjectScriptTargetError,
} from "./errors";
export {InjectScriptTargetErrorKind} from "./types";
export type {InjectScriptErrorCode} from "./errors";
export type {
    InjectScriptAllFramesTarget,
    InjectScriptContract,
    InjectScriptDocumentsTarget,
    InjectScriptExecutionOptions,
    InjectScriptFramesTarget,
    InjectScriptFunctionResult,
    InjectScriptOptions,
    InjectScriptResult,
    InjectScriptResultTarget,
    InjectScriptTarget,
    InjectScriptTargetError,
    InjectScriptTargetFailure,
    InjectScriptTargetSuccess,
    InjectScriptTargetTimeoutError,
    InjectScriptTopFrameTarget,
    JsonCompatible,
    JsonPrimitive,
    JsonValue,
    NonEmptyReadonlyArray,
    SerializedInjectScriptError,
} from "./types";

export const injectScript = (options: InjectScriptOptions): InjectScriptContract => {
    return isManifestVersion3() ? new InjectScriptV3(options) : new InjectScriptV2(options);
};

export default injectScript;
