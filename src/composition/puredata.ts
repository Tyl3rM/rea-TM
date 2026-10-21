import { PureDataService } from "../application/puredata/PureDataService.js";
import { PureDataProvider } from "../puredata/PureDataProvider.js";

/** Compose bundled offline Pure Data patch inspection with no patch evaluation or process launch. */
export const createPureDataService = (): PureDataService =>
  new PureDataService(new PureDataProvider());
