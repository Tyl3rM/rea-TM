import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type { CoreMlPort } from "../application/coreml/CoreMlPort.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import {
  coreMlModelSchema,
  projectCoreMlMetadata,
  type CoreMlModel,
  type InspectCoreMlModelInput,
} from "../domain/coreml/coreMlModel.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";

/** Bundled Core ML metadata reader; declared facts only, no model loading. */
export const CORE_ML_PROVIDER_IDENTITY = {
  id: "coreml-metadata",
  name: "REA Core ML metadata reader",
  version: "1",
} as const;
const OPERATION = "inspect_coreml_model";
const METADATA_BYTES = 32 * 1024 * 1024;

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const failureFor = (
  cause: unknown,
  path: string,
  signal?: AbortSignal,
): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  if (signal?.aborted) return new AnalysisCancelledError(OPERATION, { cause });
  if (cause instanceof ArtifactReaderFailure) {
    if (cause.reason === "integrity")
      return new AnalysisArtifactChangedError(OPERATION, path, cause.message, {
        cause,
      });
    if (cause.reason === "cancelled")
      return new AnalysisCancelledError(OPERATION, { cause });
    if (cause.reason === "limit")
      return new AnalysisResourceConstraintError(
        OPERATION,
        "file-size",
        cause.message,
        { maximum_input_bytes: METADATA_BYTES },
        { cause },
      );
    return new AnalysisInputError(OPERATION, { cause }, [
      {
        path: ["path"],
        reason: "invalid_value",
        message: `${cause.message} (expected a .mlmodelc directory containing metadata.json): ${path}`,
      },
    ]);
  }
  if (cause instanceof SyntaxError)
    return new AnalysisInputError(OPERATION, { cause }, [
      {
        path: ["path"],
        reason: "invalid_format",
        message: `metadata.json in ${path} is not valid JSON.`,
      },
    ]);
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(OPERATION, path, cause.code, {
        cause,
      });
    if (
      ["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"].includes(
        String(cause.code),
      )
    )
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `No readable metadata.json in the selected .mlmodelc directory (${String(cause.code)}): ${path}.`,
        },
      ]);
  }
  return new ProviderAdapterError(CORE_ML_PROVIDER_IDENTITY.id, OPERATION, {
    cause,
    diagnostics: {
      path,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

/** Read a compiled model's declared metadata without loading or running it. */
export class CoreMlProvider implements CoreMlPort {
  readonly identity = CORE_ML_PROVIDER_IDENTITY;
  readonly #resources = new ArtifactResourceScope();

  close(): Promise<void> {
    return this.#resources.close();
  }

  async inspect(
    input: InspectCoreMlModelInput,
    options?: ExecutionOptions,
  ): Promise<Result<CoreMlModel, AnalysisError>> {
    const directory = input.path;
    try {
      if (!isAbsolute(directory))
        throw new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: "Expected an absolute filesystem path on this host.",
          },
        ]);
      const metadataPath = join(directory, "metadata.json");
      const snapshot = await this.#resources.run(() =>
        readStableArtifact(
          metadataPath,
          METADATA_BYTES,
          options?.signal,
          undefined,
          this.#resources,
        ),
      );
      options?.signal?.throwIfAborted();
      const parsed: unknown = JSON.parse(snapshot.bytes.toString("utf8"));
      const report = projectCoreMlMetadata(parsed);
      const [hasMlProgram, hasWeights] = await Promise.all([
        exists(join(directory, "model.mil")),
        exists(join(directory, "weights")),
      ]);
      options?.signal?.throwIfAborted();
      const value = {
        ...report,
        artifact: {
          path: directory,
          metadata_sha256: snapshot.sha256,
          metadata_bytes: snapshot.bytes.length,
          has_ml_program: hasMlProgram,
          has_weights: hasWeights,
        },
        format: "mlmodelc" as const,
      };
      const validated = coreMlModelSchema.safeParse(value);
      if (!validated.success)
        throw new AnalysisOutputError(
          OPERATION,
          "Core ML reader produced invalid metadata values.",
          { cause: validated.error },
        );
      return ok(validated.data);
    } catch (cause: unknown) {
      return err(failureFor(cause, directory, options?.signal));
    }
  }
}
