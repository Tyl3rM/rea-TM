import { describe, expect, it } from "vitest";

import { coreMlReportSchema, projectCoreMlMetadata } from "./coreMlModel.js";

// Shapes mirror Apple's compiled metadata.json (an array with one model entry).
const pipelineClassifier = [
  {
    shortDescription: "Out-of-ear Detection (Logistic Regression)",
    metadataOutputVersion: "3.0",
    version: "0.1.0",
    author: "A. N. Other",
    specificationVersion: 1,
    isUpdatable: "0",
    method: "predict",
    generatedClassName: "lr_600s",
    modelType: {
      name: "MLModelType_pipelineClassifier",
      structure: [
        { name: "MLModelType_scaler" },
        { name: "MLModelType_glmClassifier" },
      ],
    },
    inputSchema: [
      {
        isOptional: "0",
        dataType: "Double",
        formattedType: "MultiArray (Double 13)",
        shortDescription: "Feature vector of length 13",
        shape: "[13]",
        name: "input",
        type: "MultiArray",
      },
    ],
    outputSchema: [
      {
        isOptional: "0",
        formattedType: "Int64",
        type: "Int64",
        name: "classLabel",
        shortDescription: "Predicted class",
      },
    ],
    classLabels: [0, 1],
    userDefinedMetadata: {
      class_labels: '["notworn", "worn"]',
      window_sec: "600.0",
      raw_fs: "100",
    },
  },
];

const mlProgram = [
  {
    shortDescription: "Sleep Staging Model | MLFlow run ID: abc123",
    version: "2.2.0",
    author: "someone",
    specificationVersion: 6,
    storagePrecision: "Float16",
    computePrecision: "Mixed (Float16, Float32, Int32)",
    modelType: { name: "MLModelType_mlProgram" },
    inputSchema: [
      {
        dataType: "Float32",
        formattedType: "MultiArray (Float32 1 × 21 × 1 × 29 × 128)",
        shape: "[1, 21, 1, 29, 128]",
        name: "x",
        type: "MultiArray",
        isOptional: "0",
      },
    ],
    outputSchema: [
      {
        dataType: "Float32",
        formattedType: "MultiArray (Float32 1 × 5)",
        shape: "[1, 5]",
        name: "linear_37",
        type: "MultiArray",
        isOptional: "0",
      },
    ],
    mlProgramOperationTypeHistogram: {
      Linear: 38,
      Reshape: 78,
      Transpose: 60,
      Conv: 3,
    },
  },
];

describe("projectCoreMlMetadata", () => {
  it("normalizes a pipeline classifier's schema, labels and metadata", () => {
    const report = projectCoreMlMetadata(pipelineClassifier);
    expect(coreMlReportSchema.safeParse(report).success).toBe(true);
    expect(report.model_type).toBe("MLModelType_pipelineClassifier");
    expect(report.pipeline_structure).toEqual([
      "MLModelType_scaler",
      "MLModelType_glmClassifier",
    ]);
    expect(report.inputs).toEqual([
      {
        name: "input",
        type: "MultiArray",
        formatted_type: "MultiArray (Double 13)",
        data_type: "Double",
        shape: [13],
        optional: false,
        description: "Feature vector of length 13",
      },
    ]);
    expect(report.outputs[0]?.name).toBe("classLabel");
    expect(report.class_label_count).toBe(2);
    expect(report.class_labels).toEqual([0, 1]);
    expect(report.author).toBe("A. N. Other");
    expect(report.specification_version).toBe(1);
    expect(
      report.user_defined_metadata.find((m) => m.key === "window_sec")?.value,
    ).toBe("600.0");
    expect(report.operation_histogram).toEqual([]);
  });

  it("summarizes an ML Program's op histogram sorted by count and parses a 5-D shape", () => {
    const report = projectCoreMlMetadata(mlProgram);
    expect(report.model_type).toBe("MLModelType_mlProgram");
    expect(report.storage_precision).toBe("Float16");
    expect(report.inputs[0]?.shape).toEqual([1, 21, 1, 29, 128]);
    expect(report.outputs[0]?.shape).toEqual([1, 5]);
    expect(report.operation_histogram.slice(0, 2)).toEqual([
      { op: "Reshape", count: 78 },
      { op: "Transpose", count: 60 },
    ]);
    expect(report.class_label_count).toBe(0);
  });

  it("accepts a bare object, records extra models, and bounds class labels", () => {
    const many = {
      modelType: { name: "MLModelType_treeEnsembleClassifier" },
      classLabels: Array.from({ length: 300 }, (_, index) => index),
    };
    const report = projectCoreMlMetadata([many, many]);
    expect(report.extra_model_count).toBe(1);
    expect(report.class_label_count).toBe(300);
    expect(report.class_labels.length).toBe(256);
    expect(report.limitations.some((l) => l.includes("300 class labels"))).toBe(
      true,
    );
    expect(report.limitations.some((l) => l.includes("2 models"))).toBe(true);
  });

  it("throws on an empty metadata array", () => {
    expect(() => projectCoreMlMetadata([])).toThrow(/no model entry/);
  });
});
