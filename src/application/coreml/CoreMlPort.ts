import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  CoreMlModel,
  InspectCoreMlModelInput,
} from "../../domain/coreml/coreMlModel.js";
import type { Result } from "../../domain/result.js";

/** Replaceable offline Core ML metadata reader with no model-loading authority. */
export interface CoreMlPort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectCoreMlModelInput,
    options?: ExecutionOptions,
  ): Promise<Result<CoreMlModel, AnalysisError>>;
}
