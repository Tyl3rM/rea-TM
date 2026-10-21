import { describe, expect, it } from "vitest";

import {
  DEFAULT_PUREDATA_PARSE_LIMITS,
  parsePureDataPatch,
  pureDataReportSchema,
} from "./pureDataPatch.js";

// A small but representative patch written from the Pd file-format spec.
const patch = [
  "#N canvas 0 0 450 300 12;",
  "#X declare -path abs;",
  "#X declare -path libs/fluid;",
  "#X obj 20 20 r AM-band1-centerFreq;",
  "#X obj 20 60 r AM-band1-intensity;",
  "#X obj 20 100 s stimphase;",
  "#X obj 20 140 osc~ 440;",
  "#X obj 20 180 osc~ 220;",
  "#X obj 20 220 tgl 15 0 bang-send recv-sym 0 20 0 -8 12;",
  "#X msg 200 20 1;",
  "#X text 200 60 a comment here;",
  "#N canvas 10 10 200 200 sub 0;",
  "#X obj 10 10 r subReceive;",
  "#X restore 300 20 pd sub;",
  "#X connect 3 0 6 0;",
  "#X connect 4 0 6 0;",
  "",
].join("\n");

describe("parsePureDataPatch", () => {
  it("recovers structure, class histogram and the send/receive control API", () => {
    const report = parsePureDataPatch(patch);
    expect(pureDataReportSchema.safeParse(report).success).toBe(true);
    expect(report.canvas_count).toBe(2);
    expect(report.max_depth).toBe(2);
    expect(report.connection_count).toBe(2);
    expect(report.message_count).toBe(1);
    expect(report.comment_count).toBe(1);
    // Two osc~, plus the restored subpatch counted as a `pd` object.
    expect(report.object_classes.find((c) => c.class === "osc~")).toEqual({
      class: "osc~",
      count: 2,
    });
    expect(report.object_classes.find((c) => c.class === "pd")).toEqual({
      class: "pd",
      count: 1,
    });
    expect(report.receives).toEqual([
      "AM-band1-centerFreq",
      "AM-band1-intensity",
      "recv-sym",
      "subReceive",
    ]);
    expect(report.sends).toEqual(["bang-send", "stimphase"]);
    expect(report.declared_paths).toEqual(["abs", "libs/fluid"]);
    expect(report.coverage.truncated).toBe(false);
  });

  it("drops empty GUI send/receive placeholders", () => {
    const report = parsePureDataPatch(
      "#N canvas 0 0 1 1 12;\n#X obj 0 0 tgl 15 0 empty - 0 20 0;\n",
    );
    expect(report.sends).toEqual([]);
    expect(report.receives).toEqual([]);
  });

  it("bounds record count", () => {
    const many =
      "#N canvas 0 0 1 1 12;\n" +
      Array.from({ length: 50 }, () => "#X obj 0 0 osc~ 1;").join("\n");
    const report = parsePureDataPatch(many, {
      ...DEFAULT_PUREDATA_PARSE_LIMITS,
      maxRecords: 10,
    });
    expect(report.coverage.records).toBe(10);
    expect(report.coverage.truncated).toBe(true);
    expect(report.limitations.length).toBeGreaterThan(0);
  });
});
