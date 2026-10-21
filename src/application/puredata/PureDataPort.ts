import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  PureDataPatch,
  InspectPureDataInput,
} from "../../domain/puredata/pureDataPatch.js";
import type { Result } from "../../domain/result.js";

/** Replaceable offline Pure Data patch reader with no patch-evaluation authority. */
export interface PureDataPort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectPureDataInput,
    options?: ExecutionOptions,
  ): Promise<Result<PureDataPatch, AnalysisError>>;
}
