import { CoreMlService } from "../application/coreml/CoreMlService.js";
import { CoreMlProvider } from "../coreml/CoreMlProvider.js";

/** Compose bundled offline Core ML metadata inspection with no model loading or process launch. */
export const createCoreMlService = (): CoreMlService =>
  new CoreMlService(new CoreMlProvider());
