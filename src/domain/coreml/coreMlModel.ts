import { z } from "zod";

import { digestSchema } from "../digests.js";
import { localPathStringSchema } from "../localPath.js";

/**
 * Read-only projection of a compiled Core ML model (`.mlmodelc`). Apple writes
 * a `metadata.json` describing the model's type, specification version,
 * input/output feature schema, class labels, author-supplied metadata, and —
 * for ML Program models — an operation-type histogram that summarises the
 * network. This module normalizes that JSON into stable, bounded facts without
 * loading, compiling, or running the model. The weight tensors in `weights/`
 * and the compiled `coremldata.bin` are never decoded; only declared metadata
 * is read.
 */

const MAX_CLASS_LABELS = 256;
const MAX_METADATA_VALUE_CHARS = 4096;

const shapeFromString = (raw: unknown): number[] | null => {
  if (typeof raw !== "string") return null;
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (inner === "") return null;
  const parts = inner.split(",").map((part) => Number(part.trim()));
  return parts.every((value) => Number.isFinite(value)) ? parts : null;
};

const featureSchema = z.strictObject({
  name: z.string(),
  type: z.string().nullable(),
  formatted_type: z.string().nullable(),
  data_type: z.string().nullable(),
  shape: z.array(z.number()).nullable(),
  optional: z.boolean(),
  description: z.string().nullable(),
});

const histogramEntrySchema = z.strictObject({
  op: z.string(),
  count: z.number().int().nonnegative(),
});

const metadataEntrySchema = z.strictObject({
  key: z.string(),
  value: z.string(),
  truncated: z.boolean(),
});

/** Normalized, bounded facts for one compiled Core ML model. */
export const coreMlReportSchema = z.strictObject({
  short_description: z.string().nullable(),
  version: z.string().nullable(),
  author: z.string().nullable(),
  specification_version: z.number().int().nullable(),
  metadata_output_version: z.string().nullable(),
  model_type: z.string().nullable(),
  pipeline_structure: z.array(z.string()),
  storage_precision: z.string().nullable(),
  compute_precision: z.string().nullable(),
  updatable: z.boolean(),
  method: z.string().nullable(),
  generated_class_name: z.string().nullable(),
  inputs: z.array(featureSchema),
  outputs: z.array(featureSchema),
  class_label_count: z.number().int().nonnegative(),
  class_labels: z.array(z.union([z.string(), z.number()])),
  operation_histogram: z.array(histogramEntrySchema),
  user_defined_metadata: z.array(metadataEntrySchema),
  extra_model_count: z.number().int().nonnegative(),
  limitations: z.array(z.string()),
});

export type CoreMlReport = z.infer<typeof coreMlReportSchema>;

/** Complete artifact-bound observation for CLI and MCP Evidence. */
export const coreMlModelSchema = coreMlReportSchema.extend({
  artifact: z.strictObject({
    path: localPathStringSchema,
    metadata_sha256: digestSchema,
    metadata_bytes: z.number().int().nonnegative(),
    has_ml_program: z.boolean(),
    has_weights: z.boolean(),
  }),
  format: z.literal("mlmodelc"),
});

export type CoreMlModel = z.infer<typeof coreMlModelSchema>;

export const inspectCoreMlModelInputSchema = z.strictObject({
  path: localPathStringSchema.describe(
    "Absolute filesystem path to the compiled .mlmodelc model directory",
  ),
});

export type InspectCoreMlModelInput = z.infer<
  typeof inspectCoreMlModelInputSchema
>;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const feature = (raw: unknown): z.infer<typeof featureSchema> => {
  const record = asRecord(raw);
  return {
    name: typeof record.name === "string" ? record.name : "",
    type: asString(record.type),
    formatted_type: asString(record.formattedType),
    data_type: asString(record.dataType),
    shape: shapeFromString(record.shape),
    optional: record.isOptional === "1" || record.isOptional === true,
    description: asString(record.shortDescription),
  };
};

/**
 * Project one Core ML `metadata.json` document (Apple writes an array with one
 * entry per model) into normalized facts. Unknown or missing fields become
 * explicit nulls/empties rather than guesses.
 */
export const projectCoreMlMetadata = (parsed: unknown): CoreMlReport => {
  const limitations: string[] = [];
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length === 0)
    throw new Error("Core ML metadata.json held no model entry");
  const model = asRecord(entries[0]);
  const extraModelCount = Math.max(0, entries.length - 1);
  if (extraModelCount > 0)
    limitations.push(
      `metadata.json described ${entries.length} models; only the first is reported.`,
    );

  const modelType = asRecord(model.modelType);
  const pipelineStructure = asArray(modelType.structure)
    .map((item) => asString(asRecord(item).name))
    .filter((name): name is string => name !== null);

  const classLabelsRaw = asArray(model.classLabels);
  const classLabels = classLabelsRaw
    .slice(0, MAX_CLASS_LABELS)
    .map((label) =>
      typeof label === "number" || typeof label === "string"
        ? label
        : String(label),
    );
  if (classLabelsRaw.length > MAX_CLASS_LABELS)
    limitations.push(
      `Model declares ${classLabelsRaw.length} class labels; the first ${MAX_CLASS_LABELS} are listed.`,
    );

  const histogram = asRecord(model.mlProgramOperationTypeHistogram);
  const operationHistogram = Object.entries(histogram)
    .filter(([, count]) => typeof count === "number")
    .map(([op, count]) => ({ op, count: count as number }))
    .sort((a, b) => b.count - a.count || a.op.localeCompare(b.op));

  const udm = asRecord(model.userDefinedMetadata);
  const userDefinedMetadata = Object.entries(udm).map(([key, value]) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const truncated = text.length > MAX_METADATA_VALUE_CHARS;
    return {
      key,
      value: truncated ? text.slice(0, MAX_METADATA_VALUE_CHARS) : text,
      truncated,
    };
  });

  const specification =
    typeof model.specificationVersion === "number"
      ? model.specificationVersion
      : null;

  return {
    short_description: asString(model.shortDescription),
    version: asString(model.version),
    author: asString(model.author),
    specification_version: specification,
    metadata_output_version: asString(model.metadataOutputVersion),
    model_type: asString(modelType.name),
    pipeline_structure: pipelineStructure,
    storage_precision: asString(model.storagePrecision),
    compute_precision: asString(model.computePrecision),
    updatable: model.isUpdatable === "1" || model.isUpdatable === true,
    method: asString(model.method),
    generated_class_name: asString(model.generatedClassName),
    inputs: asArray(model.inputSchema).map(feature),
    outputs: asArray(model.outputSchema).map(feature),
    class_label_count: classLabelsRaw.length,
    class_labels: classLabels,
    operation_histogram: operationHistogram,
    user_defined_metadata: userDefinedMetadata,
    extra_model_count: extraModelCount,
    limitations,
  };
};
