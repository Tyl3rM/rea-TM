import { z } from "zod";

import { digestSchema } from "../digests.js";
import { localPathStringSchema } from "../localPath.js";

/**
 * Read-only parser for the Rive runtime format (`.riv`). Rive serializes a
 * header, a table of contents mapping property keys to backing types, then a
 * flat object stream. Names of artboards, animations, state machines, inputs
 * and assets are stored as string properties; this parser walks the stream
 * using the file's own ToC and reports those facts without rendering,
 * executing, or interpreting vector or animation data. Unknown object classes
 * and property values are skipped by backing type, so forward-compatible files
 * still yield their named structure. Nothing is mutated and no code runs.
 *
 * Type and property keys follow the public rive-runtime field definitions.
 */

// Backing types stored 2 bits per key in the ToC bitfield.
const BACKING_UINT = 0;
const BACKING_STRING = 1;
const BACKING_DOUBLE = 2; // serialized as a 32-bit float
const BACKING_COLOR = 3; // serialized as a 32-bit unsigned int

// Object type keys (subset that carries named structure).
const TYPE_ARTBOARD = 1;
const TYPE_LINEAR_ANIMATION = 31;
const TYPE_STATE_MACHINE = 53;
const TYPE_STATE_MACHINE_NUMBER = 56;
const TYPE_STATE_MACHINE_LAYER = 57;
const TYPE_STATE_MACHINE_TRIGGER = 58;
const TYPE_STATE_MACHINE_BOOL = 59;
const TYPE_NESTED_ARTBOARD = 92;
const TYPE_IMAGE_ASSET = 105;
const TYPE_EVENT = 128;
const TYPE_TEXT_VALUE_RUN = 135;
const TYPE_FONT_ASSET = 141;
const TYPE_AUDIO_ASSET = 406;

const ASSET_TYPES = new Map<number, string>([
  [TYPE_IMAGE_ASSET, "ImageAsset"],
  [TYPE_FONT_ASSET, "FontAsset"],
  [TYPE_AUDIO_ASSET, "AudioAsset"],
]);

const TYPE_LABELS = new Map<number, string>([
  [TYPE_ARTBOARD, "Artboard"],
  [2, "Node"],
  [3, "Shape"],
  [4, "Ellipse"],
  [7, "Rectangle"],
  [18, "SolidColor"],
  [20, "Fill"],
  [22, "LinearGradient"],
  [23, "Backboard"],
  [24, "Stroke"],
  [25, "KeyedObject"],
  [26, "KeyedProperty"],
  [30, "KeyFrameDouble"],
  [TYPE_LINEAR_ANIMATION, "LinearAnimation"],
  [37, "KeyFrameColor"],
  [TYPE_STATE_MACHINE, "StateMachine"],
  [TYPE_STATE_MACHINE_NUMBER, "StateMachineNumber"],
  [TYPE_STATE_MACHINE_LAYER, "StateMachineLayer"],
  [TYPE_STATE_MACHINE_TRIGGER, "StateMachineTrigger"],
  [TYPE_STATE_MACHINE_BOOL, "StateMachineBool"],
  [61, "AnimationState"],
  [62, "AnyState"],
  [63, "EntryState"],
  [64, "ExitState"],
  [65, "StateTransition"],
  [TYPE_NESTED_ARTBOARD, "NestedArtboard"],
  [100, "Image"],
  [TYPE_IMAGE_ASSET, "ImageAsset"],
  [106, "FileAssetContents"],
  [TYPE_EVENT, "Event"],
  [134, "Text"],
  [TYPE_TEXT_VALUE_RUN, "TextValueRun"],
  [TYPE_FONT_ASSET, "FontAsset"],
  [TYPE_AUDIO_ASSET, "AudioAsset"],
]);

// Property keys.
const PROP_COMPONENT_NAME = 4; // Artboard/Event/NestedArtboard
const PROP_ARTBOARD_WIDTH = 7;
const PROP_ARTBOARD_HEIGHT = 8;
const PROP_ANIMATION_NAME = 55; // Animation and StateMachine (its subclass)
const PROP_ANIMATION_FPS = 56;
const PROP_ANIMATION_DURATION = 57;
const PROP_ANIMATION_LOOP = 59;
const PROP_SM_COMPONENT_NAME = 138; // inputs and layers
const PROP_SM_BOOL_VALUE = 141;
const PROP_SM_NUMBER_VALUE = 142;
const PROP_ASSET_NAME = 203;
const PROP_TEXT_RUN_VALUE = 268;

// Backing types for keys an older file may omit from its ToC.
const FALLBACK_BACKING = new Map<number, number>([
  [PROP_COMPONENT_NAME, BACKING_STRING],
  [5, BACKING_UINT],
  [PROP_ANIMATION_NAME, BACKING_STRING],
  [PROP_SM_COMPONENT_NAME, BACKING_STRING],
  [PROP_ASSET_NAME, BACKING_STRING],
  [204, BACKING_UINT],
  [212, BACKING_STRING],
  [PROP_TEXT_RUN_VALUE, BACKING_STRING],
]);

/** Bounds keep a malformed or hostile file from exhausting memory or time. */
export interface RiveParseLimits {
  readonly maxObjects: number;
  // Strings longer than this are consumed but recorded as a byte-count
  // placeholder rather than decoded (embedded font/image asset blobs).
  readonly maxStringBytes: number;
}

export const DEFAULT_RIVE_PARSE_LIMITS: RiveParseLimits = {
  maxObjects: 2_000_000,
  maxStringBytes: 65_536,
};

const stateMachineInputSchema = z.strictObject({
  name: z.string(),
  kind: z.enum(["number", "bool", "trigger"]),
  default: z.number().nullable(),
});

const stateMachineSchema = z.strictObject({
  name: z.string(),
  inputs: z.array(stateMachineInputSchema),
  layers: z.array(z.string()),
});

const animationSchema = z.strictObject({
  name: z.string(),
  fps: z.number().nullable(),
  duration_frames: z.number().nullable(),
  loop: z.number().nullable(),
});

const artboardSchema = z.strictObject({
  name: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  animations: z.array(animationSchema),
  state_machines: z.array(stateMachineSchema),
  events: z.array(z.string()),
  nested_artboards: z.array(z.string()),
  text_runs: z.array(z.string()),
});

const assetSchema = z.strictObject({
  kind: z.enum(["ImageAsset", "FontAsset", "AudioAsset"]),
  name: z.string(),
});

const objectCountSchema = z.strictObject({
  type: z.string(),
  type_key: z.number().int().nonnegative(),
  count: z.number().int().positive(),
});

/** Bounded facts recovered from one Rive runtime file; absence of a field is explicit. */
export const riveReportSchema = z.strictObject({
  major_version: z.number().int().nonnegative(),
  minor_version: z.number().int().nonnegative(),
  file_id: z.number().int().nonnegative(),
  toc_key_count: z.number().int().nonnegative(),
  artboards: z.array(artboardSchema),
  assets: z.array(assetSchema),
  object_counts: z.array(objectCountSchema),
  coverage: z.strictObject({
    consumed_bytes: z.number().int().nonnegative(),
    total_bytes: z.number().int().nonnegative(),
    objects: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  limitations: z.array(z.string()),
});

export type RiveReport = z.infer<typeof riveReportSchema>;

/** Complete artifact-bound Rive observation for CLI and MCP Evidence. */
export const riveFileSchema = riveReportSchema.extend({
  artifact: z.strictObject({
    path: localPathStringSchema,
    sha256: digestSchema,
    bytes: z.number().int().nonnegative(),
  }),
  format: z.literal("rive"),
});

export type RiveFile = z.infer<typeof riveFileSchema>;

export const inspectRiveFileInputSchema = z.strictObject({
  path: localPathStringSchema.describe(
    "Absolute filesystem path to the selected .riv Rive runtime file",
  ),
});

export type InspectRiveFileInput = z.infer<typeof inspectRiveFileInputSchema>;

class RiveParseError extends Error {}

/** Cursor over the file bytes; every read is bounded by the buffer length. */
class ByteReader {
  offset = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get done(): boolean {
    return this.offset >= this.bytes.length;
  }
  private require(count: number): void {
    if (this.offset + count > this.bytes.length)
      throw new RiveParseError(
        `read of ${count} byte(s) past end at offset ${this.offset}`,
      );
  }
  /** LEB128 unsigned varint, accumulated so values beyond 32 bits stay exact. */
  varuint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      this.require(1);
      const byte = this.view.getUint8(this.offset);
      this.offset += 1;
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
      if (shift > 63) throw new RiveParseError("varint exceeds 64 bits");
    }
  }
  u32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  f32(): number {
    this.require(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }
  /**
   * Read a length-prefixed byte string. Values longer than `retainMax` (large
   * embedded asset blobs such as fonts and images) are consumed but returned as
   * a byte-count placeholder, so the object stream stays aligned without
   * decoding or holding megabytes of binary payload as text.
   */
  utf8(retainMax: number): string {
    const length = this.varuint();
    this.require(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    if (length > retainMax) return `<${length} bytes>`;
    return new TextDecoder("utf-8", { fatal: false }).decode(slice);
  }
  skipBytes(): void {
    const length = this.varuint();
    this.require(length);
    this.offset += length;
  }
}

const RIVE_MAGIC = [0x52, 0x49, 0x56, 0x45]; // "RIVE"

interface MutableArtboard {
  name: string;
  width: number | null;
  height: number | null;
  animations: RiveReport["artboards"][number]["animations"];
  state_machines: {
    name: string;
    inputs: {
      name: string;
      kind: "number" | "bool" | "trigger";
      default: number | null;
    }[];
    layers: string[];
  }[];
  events: string[];
  nested_artboards: string[];
  text_runs: string[];
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const stringOrEmpty = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Walk the Rive object stream, recovering named structure within ToC bounds. */
export const parseRiveRuntime = (
  bytes: Uint8Array,
  limits: RiveParseLimits = DEFAULT_RIVE_PARSE_LIMITS,
): RiveReport => {
  if (
    bytes.length < 4 ||
    RIVE_MAGIC.some((byte, index) => bytes[index] !== byte)
  )
    throw new RiveParseError("not a RIVE runtime file (bad magic)");
  const reader = new ByteReader(bytes);
  reader.offset = 4;
  const major = reader.varuint();
  const minor = reader.varuint();
  const fileId = reader.varuint();

  // Table of contents: property keys terminated by 0, then 2-bit backing types.
  const keys: number[] = [];
  for (;;) {
    const key = reader.varuint();
    if (key === 0) break;
    keys.push(key);
    if (keys.length > 100_000)
      throw new RiveParseError("table of contents is implausibly large");
  }
  // Backing types are 2 bits per key. Each 32-bit word carries four keys in
  // its low byte (the runtime reads a fresh word after every fourth key);
  // this matches the bytes real files emit.
  const backing = new Map<number, number>();
  let word = 0;
  let bit = 8;
  for (const key of keys) {
    if (bit === 8) {
      word = reader.u32();
      bit = 0;
    }
    backing.set(key, (word >>> bit) & 3);
    bit += 2;
  }

  const artboards: MutableArtboard[] = [];
  const assets: RiveReport["assets"] = [];
  const counts = new Map<number, number>();
  const limitations: string[] = [];
  let current: MutableArtboard | undefined;
  // The byte boundary after the last fully parsed object (header+ToC if none).
  let lastGood = reader.offset;

  const backingOf = (key: number): number | undefined =>
    backing.get(key) ?? FALLBACK_BACKING.get(key);

  while (!reader.done) {
    const start = reader.offset;
    let typeKey: number;
    const props = new Map<number, number | string>();
    try {
      typeKey = reader.varuint();
      for (;;) {
        const propKey = reader.varuint();
        if (propKey === 0) break;
        const ft = backingOf(propKey);
        if (ft === undefined)
          throw new RiveParseError(
            `unknown property key ${propKey} in type ${typeKey} at offset ${start}`,
          );
        if (ft === BACKING_UINT) props.set(propKey, reader.varuint());
        else if (ft === BACKING_STRING)
          props.set(propKey, reader.utf8(limits.maxStringBytes));
        else if (ft === BACKING_DOUBLE) props.set(propKey, reader.f32());
        else props.set(propKey, reader.u32());
      }
    } catch (cause: unknown) {
      limitations.push(
        `Object stream parsing stopped at byte ${start} of ${bytes.length}; earlier objects are complete. Reason: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      break;
    }
    counts.set(typeKey, (counts.get(typeKey) ?? 0) + 1);
    lastGood = reader.offset;

    if (typeKey === TYPE_ARTBOARD) {
      current = {
        name: stringOrEmpty(props.get(PROP_COMPONENT_NAME)),
        width: numberOrNull(props.get(PROP_ARTBOARD_WIDTH)),
        height: numberOrNull(props.get(PROP_ARTBOARD_HEIGHT)),
        animations: [],
        state_machines: [],
        events: [],
        nested_artboards: [],
        text_runs: [],
      };
      artboards.push(current);
    } else if (ASSET_TYPES.has(typeKey)) {
      assets.push({
        kind: ASSET_TYPES.get(typeKey) as
          | "ImageAsset"
          | "FontAsset"
          | "AudioAsset",
        name: stringOrEmpty(props.get(PROP_ASSET_NAME)),
      });
    } else if (current !== undefined) {
      if (typeKey === TYPE_LINEAR_ANIMATION)
        current.animations.push({
          name: stringOrEmpty(props.get(PROP_ANIMATION_NAME)),
          fps: numberOrNull(props.get(PROP_ANIMATION_FPS)),
          duration_frames: numberOrNull(props.get(PROP_ANIMATION_DURATION)),
          loop: numberOrNull(props.get(PROP_ANIMATION_LOOP)),
        });
      else if (typeKey === TYPE_STATE_MACHINE)
        current.state_machines.push({
          name: stringOrEmpty(props.get(PROP_ANIMATION_NAME)),
          inputs: [],
          layers: [],
        });
      else if (
        typeKey === TYPE_STATE_MACHINE_NUMBER ||
        typeKey === TYPE_STATE_MACHINE_BOOL ||
        typeKey === TYPE_STATE_MACHINE_TRIGGER
      ) {
        const machine = current.state_machines.at(-1);
        if (machine !== undefined) {
          const kind =
            typeKey === TYPE_STATE_MACHINE_NUMBER
              ? "number"
              : typeKey === TYPE_STATE_MACHINE_BOOL
                ? "bool"
                : "trigger";
          const value =
            typeKey === TYPE_STATE_MACHINE_NUMBER
              ? numberOrNull(props.get(PROP_SM_NUMBER_VALUE))
              : typeKey === TYPE_STATE_MACHINE_BOOL
                ? numberOrNull(props.get(PROP_SM_BOOL_VALUE))
                : null;
          machine.inputs.push({
            name: stringOrEmpty(props.get(PROP_SM_COMPONENT_NAME)),
            kind,
            default: value,
          });
        }
      } else if (typeKey === TYPE_STATE_MACHINE_LAYER) {
        const machine = current.state_machines.at(-1);
        if (machine !== undefined)
          machine.layers.push(stringOrEmpty(props.get(PROP_SM_COMPONENT_NAME)));
      } else if (typeKey === TYPE_EVENT)
        current.events.push(stringOrEmpty(props.get(PROP_COMPONENT_NAME)));
      else if (typeKey === TYPE_NESTED_ARTBOARD)
        current.nested_artboards.push(
          stringOrEmpty(props.get(PROP_COMPONENT_NAME)),
        );
      else if (typeKey === TYPE_TEXT_VALUE_RUN)
        current.text_runs.push(stringOrEmpty(props.get(PROP_TEXT_RUN_VALUE)));
    }

    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    if (total >= limits.maxObjects) {
      limitations.push(
        `Object count reached the ${limits.maxObjects} bound; later objects were not parsed.`,
      );
      break;
    }
  }

  const objectCount = [...counts.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const object_counts = [...counts.entries()]
    .map(([type_key, count]) => ({
      type: TYPE_LABELS.get(type_key) ?? `type_${type_key}`,
      type_key,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.type_key - b.type_key);

  return {
    major_version: major,
    minor_version: minor,
    file_id: fileId,
    toc_key_count: keys.length,
    artboards: artboards.map((board) => ({
      name: board.name,
      width: board.width,
      height: board.height,
      animations: board.animations,
      state_machines: board.state_machines,
      events: board.events,
      nested_artboards: board.nested_artboards,
      text_runs: board.text_runs,
    })),
    assets,
    object_counts,
    coverage: {
      consumed_bytes: Math.min(lastGood, bytes.length),
      total_bytes: bytes.length,
      objects: objectCount,
      truncated: limitations.length > 0,
    },
    limitations,
  };
};

export const isRiveMagic = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 && RIVE_MAGIC.every((byte, index) => bytes[index] === byte);
