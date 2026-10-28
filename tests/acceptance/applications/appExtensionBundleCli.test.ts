import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";
import { buildBinary } from "plist";

import { encodeNibArchiveFixture } from "../../../src/artifacts/apple/NibArchive.fixture.js";
import { appleAssetCatalogResultSchema } from "../../../src/domain/apple/appleAssetCatalog.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

/** An iOS-style app extension as extracted from an IPA's PlugIns directory. */
const appExtension = async () => {
  const root = await createTestTempDirectory("rea-app-extension-");
  const appex = join(root, "Widget.appex");
  await mkdir(appex);
  await writeFile(
    join(appex, "Info.plist"),
    "<plist><dict><key>CFBundleExecutable</key><string>Widget</string><key>CFBundleIdentifier</key><string>dev.rea.widget</string></dict></plist>",
  );
  await writeFile(join(appex, "Widget"), thinMach(0xfeedfacf, 0x0100000c));
  await writeFile(
    join(appex, "Panel.nib"),
    encodeNibArchiveFixture({
      classes: ["NSIBObjectData", "NSImageView", "NSImage", "NSString"],
      objects: [
        { classIndex: 0, values: { NSRoot: { ref: 1 } } },
        { classIndex: 1, values: { image: { ref: 2 } } },
        { classIndex: 2, values: { NSImageName: { ref: 3 } } },
        { classIndex: 3, values: { "NS.bytes": "Toolbar" } },
      ],
    }),
  );
  await writeFile(
    join(appex, "Model.archive"),
    buildBinary({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $top: { root: { UID: 1 } },
      $objects: [
        "$null",
        { $class: { UID: 2 } },
        { $classname: "Widget", $classes: ["Widget", "NSObject"] },
      ],
    }),
  );
  return { root, appex };
};

describe("app extension bundles", () => {
  cliTest(
    "decodes bundle resources of an app extension through CLI and MCP",
    async ({ cli }) => {
      const { appex } = await appExtension();
      const decoded = await cli.run({
        arguments: ["decode-interface-builder", appex, "--json"],
      });
      expect(decoded.exitCode, decoded.stderr).toBe(0);
      const graph = interfaceBuilderAnalysisSchema.parse(
        parseEvidence(decoded.json).normalized_result,
      );
      expect(graph.documents.map(({ relative_path }) => relative_path)).toEqual(
        ["Panel.nib"],
      );
      const archive = await cli.run({
        arguments: ["inspect-keyed-archive", appex, "Model.archive", "--json"],
      });
      expect(archive.exitCode, archive.stderr).toBe(0);
      const dylibs = await cli.run({
        arguments: ["trace-dylib-resolution", appex, "--json"],
      });
      expect(dylibs.exitCode, dylibs.stderr).toBe(0);
      const { call } = await connectLocalToolsMcp();
      const opened = await call("open_binary", { path: appex });
      expect(opened.isError).not.toBe(true);
      const mcp = await call("decode_interface_builder", {});
      expect(mcp.isError).not.toBe(true);
      // The standalone CLI inspects resources without opening an executable;
      // the MCP operation is bound to the opened executable's identity.
      expect(graph.target_sha256).toBeNull();
      expect(graph.resource_root).toMatchObject({
        caller_path: appex,
        executable_sha256: null,
      });
      const targetSha256 = createHash("sha256")
        .update(thinMach(0xfeedfacf, 0x0100000c))
        .digest("hex");
      const { resource_root: _resourceRoot, ...shared } = graph;
      expect(parseEvidence(mcp.structuredContent).normalized_result).toEqual({
        ...shared,
        target_sha256: targetSha256,
        graph: { ...graph.graph, target_sha256: targetSha256 },
      });
    },
    30_000,
  );

  cliTest(
    "refuses bundle operations for a regular file named like an app",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-app-named-file-");
      const standalone = join(root, "Standalone.app");
      await writeFile(standalone, thinMach(0xfeedfacf, 0x0100000c));
      for (const command of [
        "decode-interface-builder",
        "inspect-asset-catalog",
      ]) {
        const refused = await cli.run({
          arguments: [command, standalone, "--json"],
        });
        expect(refused.exitCode).toBe(1);
        expect(refused.json).toMatchObject({
          message: expect.stringContaining(
            "requires an active app or app extension bundle target",
          ),
        });
      }
    },
  );

  cliTest.skipIf(process.platform !== "darwin")(
    "reads an app extension's plist and catalog inventory",
    async ({ cli }) => {
      const { appex } = await appExtension();
      const plist = await cli.run({
        arguments: ["inspect-plist", appex, "--json"],
      });
      expect(plist.exitCode, plist.stderr).toBe(0);
      expect(parseEvidence(plist.json).normalized_result).toMatchObject({
        value: { CFBundleIdentifier: "dev.rea.widget" },
      });
      const inspected = await cli.run({
        arguments: ["inspect-asset-catalog", appex, "--json"],
      });
      expect(inspected.exitCode, inspected.stderr).toBe(0);
      const result = appleAssetCatalogResultSchema.parse(
        parseEvidence(inspected.json).normalized_result,
      );
      expect(result.catalogs).toEqual([]);
      expect(result.resource_key_matches).toMatchObject([
        { source_path: "Panel.nib", key: "Toolbar", status: "unmatched" },
      ]);
    },
    30_000,
  );
});
