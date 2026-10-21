import { z } from "incur";
import { createCoreMlService } from "../composition/coreml.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";

/** Resolve caller paths and inspect compiled Core ML model metadata through the shared workflow. */
export const registerCoreMlCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.inspectCoreMlModel, {
    description:
      "Inspect a compiled Core ML model's declared metadata without loading the model",
    args: z.object({
      path: z.string().describe("Compiled .mlmodelc model directory"),
    }),
    run: ({ args }) =>
      withCommandCancellation(async (signal) => {
        const service = createCoreMlService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectCoreMlModel,
          async () =>
            finishAnalysisCommand(
              () =>
                service.inspect(
                  { path: absoluteCallerPath(args.path) },
                  { signal },
                ),
              service,
              "coreml-metadata",
              "inspect_coreml_model",
            ),
        );
      }),
  });
};
