import {
  coreMlModelSchema,
  inspectCoreMlModelInputSchema,
} from "../../domain/coreml/coreMlModel.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";

/** Static Core ML metadata is independent of active native-analysis providers and host toolchains. */
export const CORE_ML_TOOL_CONTRACTS = [
  {
    name: "inspect_coreml_model",
    ...toolContractMetadata("inspect_coreml_model"),
    kind: "artifact-provider",
    description:
      "Inspect a compiled Core ML model directory (.mlmodelc) by reading its declared metadata.json: model type and specification version, input and output feature schema with declared shapes, class labels, storage and compute precision, author-supplied userDefinedMetadata (such as training framework versions, feature names and MLflow run identifiers), and — for ML Program models — the operation-type histogram that summarises the network. Returns the metadata SHA-256 and whether a model.mil program and weights directory are present. The model is never loaded, compiled or predicted with, and weight tensors and coremldata.bin are not decoded; absent fields are reported as explicit unknowns. Class labels are bounded to the first 256 and long metadata values are truncated with an explicit flag.",
    inputSchema: inspectCoreMlModelInputSchema,
    outputSchema: evidenceResultOf(coreMlModelSchema),
    examples: [
      {
        title: "Inspect a compiled Core ML model",
        input: { path: "/artifacts/App.app/sleep_staging_model.mlmodelc" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
