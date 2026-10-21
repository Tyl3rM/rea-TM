import { z } from "zod";

import { digestSchema } from "../digests.js";
import { localPathStringSchema } from "../localPath.js";

/**
 * Read-only parser for a Pure Data patch (`.pd`). Pd patches are a plain-text
 * record format: records start with `#N`/`#X`/`#A`, end with `;`, and are
 * whitespace-tokenized with backslash escapes. This parser recovers the patch
 * structure (subpatch canvases and nesting), an object-class histogram, the
 * `send`/`receive` control symbols that form a patch's external control
 * interface, and declared search paths. It does not evaluate the patch or load
 * any abstraction, external, or audio file; it only reads the committed text.
 */

const RECEIVE_CLASSES = new Set(["r", "receive", "r~", "receive~"]);
const SEND_CLASSES = new Set(["s", "send", "s~", "send~"]);

// GUI objects carry send/receive symbols at fixed argument positions (0-based
// within the arguments that follow the class token). "empty"/"-" means none.
const GUI_SEND_RECEIVE: ReadonlyMap<
  string,
  { send: number | null; receive: number | null }
> = new Map([
  ["bng", { send: 4, receive: 5 }],
  ["tgl", { send: 2, receive: 3 }],
  ["nbx", { send: 6, receive: 7 }],
  ["hsl", { send: 6, receive: 7 }],
  ["vsl", { send: 6, receive: 7 }],
  ["hradio", { send: 4, receive: 5 }],
  ["vradio", { send: 4, receive: 5 }],
  ["cnv", { send: 3, receive: 4 }],
  ["vu", { send: 1, receive: null }],
]);

export interface PureDataParseLimits {
  readonly maxRecords: number;
}

export const DEFAULT_PUREDATA_PARSE_LIMITS: PureDataParseLimits = {
  maxRecords: 2_000_000,
};

const classCountSchema = z.strictObject({
  class: z.string(),
  count: z.number().int().positive(),
});

/** Bounded facts recovered from one Pure Data patch. */
export const pureDataReportSchema = z.strictObject({
  canvas_count: z.number().int().nonnegative(),
  max_depth: z.number().int().nonnegative(),
  object_count: z.number().int().nonnegative(),
  message_count: z.number().int().nonnegative(),
  comment_count: z.number().int().nonnegative(),
  connection_count: z.number().int().nonnegative(),
  array_count: z.number().int().nonnegative(),
  object_classes: z.array(classCountSchema),
  receives: z.array(z.string()),
  sends: z.array(z.string()),
  declared_paths: z.array(z.string()),
  coverage: z.strictObject({
    records: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  limitations: z.array(z.string()),
});

export type PureDataReport = z.infer<typeof pureDataReportSchema>;

/** Complete artifact-bound observation for CLI and MCP Evidence. */
export const pureDataPatchSchema = pureDataReportSchema.extend({
  artifact: z.strictObject({
    path: localPathStringSchema,
    sha256: digestSchema,
    bytes: z.number().int().nonnegative(),
  }),
  format: z.literal("puredata"),
});

export type PureDataPatch = z.infer<typeof pureDataPatchSchema>;

export const inspectPureDataInputSchema = z.strictObject({
  path: localPathStringSchema.describe(
    "Absolute filesystem path to the selected .pd Pure Data patch",
  ),
});

export type InspectPureDataInput = z.infer<typeof inspectPureDataInputSchema>;

/** Split the text into `;`-terminated records, honoring backslash escapes. */
const splitRecords = (text: string): string[] => {
  const records: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && index + 1 < text.length) {
      current += text.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (char === ";") {
      const trimmed = current.trim();
      if (trimmed !== "") records.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail !== "") records.push(tail);
  return records;
};

/** Tokenize a record on unescaped whitespace. */
const tokenize = (record: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  for (let index = 0; index < record.length; index += 1) {
    const char = record[index];
    if (char === "\\" && index + 1 < record.length) {
      current += record.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current !== "") tokens.push(current);
  return tokens;
};

const unescape = (value: string): string =>
  value
    .replace(/\\;/g, ";")
    .replace(/\\,/g, ",")
    .replace(/\\\$/g, "$")
    .replace(/\\ /g, " ");

const symbol = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const text = unescape(value);
  return text === "" || text === "-" || text === "empty" ? null : text;
};

/** Parse one Pure Data patch's committed text into bounded structural facts. */
export const parsePureDataPatch = (
  text: string,
  limits: PureDataParseLimits = DEFAULT_PUREDATA_PARSE_LIMITS,
): PureDataReport => {
  const records = splitRecords(text);
  const limitations: string[] = [];
  let truncated = false;
  let consumed = records.length;
  if (records.length > limits.maxRecords) {
    truncated = true;
    consumed = limits.maxRecords;
    limitations.push(
      `Patch has ${records.length} records; only the first ${limits.maxRecords} were parsed.`,
    );
  }

  let depth = 0;
  let maxDepth = 0;
  let canvasCount = 0;
  let objectCount = 0;
  let messageCount = 0;
  let commentCount = 0;
  let connectionCount = 0;
  let arrayCount = 0;
  const classCounts = new Map<string, number>();
  const receives = new Set<string>();
  const sends = new Set<string>();
  const declaredPaths = new Set<string>();

  const addReceive = (value: string | null): void => {
    if (value !== null) receives.add(value);
  };
  const addSend = (value: string | null): void => {
    if (value !== null) sends.add(value);
  };

  for (const record of records.slice(0, consumed)) {
    const tokens = tokenize(record);
    if (tokens.length === 0) continue;
    const [tag, kind] = tokens;
    if (tag === "#N" && kind === "canvas") {
      depth += 1;
      canvasCount += 1;
      maxDepth = Math.max(maxDepth, depth);
      continue;
    }
    if (tag !== "#X") continue;
    if (kind === "restore") {
      if (depth > 0) depth -= 1;
      // A restored subpatch appears as an object in its parent.
      objectCount += 1;
      const args = tokens.slice(4).map(unescape);
      const cls = args[0] ?? "pd";
      classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
      continue;
    }
    if (kind === "connect") {
      connectionCount += 1;
      continue;
    }
    if (kind === "obj") {
      objectCount += 1;
      const args = tokens.slice(4);
      const first = args[0];
      const cls = first === undefined ? "(empty)" : unescape(first);
      classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
      const params = args.slice(1);
      if (RECEIVE_CLASSES.has(cls)) addReceive(symbol(params[0]));
      else if (SEND_CLASSES.has(cls)) addSend(symbol(params[0]));
      else {
        const gui = GUI_SEND_RECEIVE.get(cls);
        if (gui !== undefined) {
          if (gui.send !== null) addSend(symbol(params[gui.send]));
          if (gui.receive !== null) addReceive(symbol(params[gui.receive]));
        }
      }
      continue;
    }
    if (kind === "msg") {
      messageCount += 1;
      continue;
    }
    if (kind === "text") {
      commentCount += 1;
      continue;
    }
    if (kind === "floatatom" || kind === "symbolatom" || kind === "listbox") {
      objectCount += 1;
      classCounts.set(kind, (classCounts.get(kind) ?? 0) + 1);
      continue;
    }
    if (kind === "array") {
      arrayCount += 1;
      continue;
    }
    if (kind === "declare") {
      const args = tokens.slice(2).map(unescape);
      const pathIndex = args.indexOf("-path");
      const declaredPath = pathIndex >= 0 ? args[pathIndex + 1] : undefined;
      if (declaredPath !== undefined) declaredPaths.add(declaredPath);
      const libIndex = args.indexOf("-lib");
      const declaredLib = libIndex >= 0 ? args[libIndex + 1] : undefined;
      if (declaredLib !== undefined) declaredPaths.add(`lib:${declaredLib}`);
    }
  }

  const sortStrings = (values: Set<string>): string[] =>
    [...values].sort((a, b) => a.localeCompare(b));

  return {
    canvas_count: canvasCount,
    max_depth: maxDepth,
    object_count: objectCount,
    message_count: messageCount,
    comment_count: commentCount,
    connection_count: connectionCount,
    array_count: arrayCount,
    object_classes: [...classCounts.entries()]
      .map(([className, count]) => ({ class: className, count }))
      .sort((a, b) => b.count - a.count || a.class.localeCompare(b.class)),
    receives: sortStrings(receives),
    sends: sortStrings(sends),
    declared_paths: sortStrings(declaredPaths),
    coverage: { records: consumed, truncated },
    limitations,
  };
};
