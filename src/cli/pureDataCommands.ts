import { z } from "incur";
import { createPureDataService } from "../composition/puredata.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";

/** Resolve caller paths and inspect a Pure Data patch's structure through the shared workflow. */
export const registerPureDataCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.inspectPureData, {
    description:
      "Inspect a Pure Data patch's structure and send/receive control symbols without evaluating it",
    args: z.object({
      path: z.string().describe("Pure Data .pd patch file"),
    }),
    run: ({ args }) =>
      withCommandCancellation(async (signal) => {
        const service = createPureDataService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectPureData,
          async () =>
            finishAnalysisCommand(
              () =>
                service.inspect(
                  { path: absoluteCallerPath(args.path) },
                  { signal },
                ),
              service,
              "puredata-reader",
              "inspect_puredata",
            ),
        );
      }),
  });
};
