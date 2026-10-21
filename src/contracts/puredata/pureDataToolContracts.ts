import {
  pureDataPatchSchema,
  inspectPureDataInputSchema,
} from "../../domain/puredata/pureDataPatch.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";

/** Static Pure Data patch structure is independent of active native-analysis providers and host toolchains. */
export const PURE_DATA_TOOL_CONTRACTS = [
  {
    name: "inspect_puredata",
    ...toolContractMetadata("inspect_puredata"),
    kind: "artifact-provider",
    description:
      "Inspect a Pure Data patch (.pd) as committed text: subpatch canvas count and nesting depth, an object-class histogram, the send and receive control symbols that form the patch's external control interface (including GUI object sends/receives), declared search paths and libraries, and object/message/comment/connection/array counts. The patch is parsed from its record text only; no abstraction, external, or audio file is loaded and the patch is never evaluated. Control symbols defined inside referenced abstraction files are recovered by inspecting those files; this reports one patch at a time. Resource guards bound the record count and report truncation explicitly.",
    inputSchema: inspectPureDataInputSchema,
    outputSchema: evidenceResultOf(pureDataPatchSchema),
    examples: [
      {
        title: "Inspect an audio engine patch",
        input: { path: "/artifacts/App.app/NSam/_NSam.pd" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
