import { describe, expect, it } from "vitest";

import {
  DEFAULT_RIVE_PARSE_LIMITS,
  isRiveMagic,
  parseRiveRuntime,
  riveReportSchema,
} from "./riveFile.js";

// A minimal Rive runtime encoder, written from the public format definition so
// the fixtures encode expected behaviour independently of the parser.
const varuint = (value: number): number[] => {
  const out: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    out.push(byte);
  } while (remaining > 0);
  return out;
};
const f32 = (value: number): number[] => {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  return [...new Uint8Array(buffer)];
};
const u32 = (value: number): number[] => {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value >>> 0, true);
  return [...new Uint8Array(buffer)];
};
const str = (text: string): number[] => {
  const bytes = [...new TextEncoder().encode(text)];
  return [...varuint(bytes.length), ...bytes];
};

const BACKING: ReadonlyArray<readonly [number, number]> = [
  [4, 1],
  [7, 2],
  [8, 2],
  [55, 1],
  [56, 2],
  [57, 2],
  [59, 0],
  [138, 1],
  [141, 0],
  [142, 2],
  [203, 1],
  [268, 1],
];

const toc = (): number[] => {
  const keys = BACKING.flatMap(([key]) => varuint(key));
  // 2 bits per key, LSB-first, one little-endian u32 per four keys (the
  // runtime reads a fresh word after every fourth key).
  const words: number[] = [];
  let word = 0;
  BACKING.forEach(([, backing], index) => {
    const slot = index % 4;
    word |= (backing & 3) << (slot * 2);
    if (slot === 3) {
      words.push(word);
      word = 0;
    }
  });
  if (BACKING.length % 4 !== 0) words.push(word);
  return [...keys, 0, ...words.flatMap((value) => u32(value))];
};

// typeKey, then (propKey, value) pairs, terminated by propKey 0.
const obj = (typeKey: number, body: number[]): number[] => [
  ...varuint(typeKey),
  ...body,
  0,
];
const prop = (key: number, value: number[]): number[] => [
  ...varuint(key),
  ...value,
];

const fixture = (): Uint8Array => {
  const bytes: number[] = [
    0x52,
    0x49,
    0x56,
    0x45, // "RIVE"
    ...varuint(7), // major
    ...varuint(0), // minor
    ...varuint(4660), // fileId
    ...toc(),
    ...obj(1, [
      ...prop(4, str("Board A")),
      ...prop(7, f32(100)),
      ...prop(8, f32(200)),
    ]),
    ...obj(31, [
      ...prop(55, str("intro")),
      ...prop(56, f32(60)),
      ...prop(57, f32(30)),
      ...prop(59, varuint(1)),
    ]),
    ...obj(53, [...prop(55, str("SM"))]),
    ...obj(56, [...prop(138, str("level")), ...prop(142, f32(3))]),
    ...obj(59, [...prop(138, str("on")), ...prop(141, varuint(1))]),
    ...obj(58, [...prop(138, str("go"))]),
    ...obj(57, [...prop(138, str("Layer 1"))]),
    ...obj(128, [...prop(4, str("tap"))]),
    ...obj(92, [...prop(4, str("Nested"))]),
    ...obj(135, [...prop(268, str("hello"))]),
    ...obj(105, [...prop(203, str("img"))]),
  ];
  return new Uint8Array(bytes);
};

describe("parseRiveRuntime", () => {
  it("recovers the named structure of a well-formed file through the ToC", () => {
    const report = parseRiveRuntime(fixture());
    expect(riveReportSchema.safeParse(report).success).toBe(true);
    expect({
      major_version: report.major_version,
      minor_version: report.minor_version,
      file_id: report.file_id,
      toc_key_count: report.toc_key_count,
    }).toEqual({
      major_version: 7,
      minor_version: 0,
      file_id: 4660,
      toc_key_count: 12,
    });
    expect(report.artboards).toEqual([
      {
        name: "Board A",
        width: 100,
        height: 200,
        animations: [{ name: "intro", fps: 60, duration_frames: 30, loop: 1 }],
        state_machines: [
          {
            name: "SM",
            inputs: [
              { name: "level", kind: "number", default: 3 },
              { name: "on", kind: "bool", default: 1 },
              { name: "go", kind: "trigger", default: null },
            ],
            layers: ["Layer 1"],
          },
        ],
        events: ["tap"],
        nested_artboards: ["Nested"],
        text_runs: ["hello"],
      },
    ]);
    expect(report.assets).toEqual([{ kind: "ImageAsset", name: "img" }]);
    expect(report.coverage.truncated).toBe(false);
    expect(report.coverage.consumed_bytes).toBe(report.coverage.total_bytes);
    expect(report.limitations).toEqual([]);
    expect(report.object_counts.find((c) => c.type === "Artboard")).toEqual({
      type: "Artboard",
      type_key: 1,
      count: 1,
    });
  });

  it("keeps earlier objects and records a limitation when the stream is truncated", () => {
    const full = fixture();
    const cut = full.subarray(0, full.length - 3);
    const report = parseRiveRuntime(cut);
    expect(report.artboards[0]?.name).toBe("Board A");
    expect(report.coverage.truncated).toBe(true);
    expect(report.limitations.length).toBeGreaterThan(0);
    expect(report.limitations[0]).toContain("stopped at byte");
  });

  it("rejects a file without the RIVE magic", () => {
    expect(() =>
      parseRiveRuntime(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])),
    ).toThrow(/RIVE/);
    expect(isRiveMagic(new Uint8Array([0x52, 0x49, 0x56, 0x45]))).toBe(true);
    expect(isRiveMagic(new Uint8Array([0x00]))).toBe(false);
  });

  it("bounds object count", () => {
    const report = parseRiveRuntime(fixture(), {
      ...DEFAULT_RIVE_PARSE_LIMITS,
      maxObjects: 2,
    });
    expect(report.coverage.objects).toBe(2);
    expect(report.limitations.some((l) => l.includes("bound"))).toBe(true);
  });
});
