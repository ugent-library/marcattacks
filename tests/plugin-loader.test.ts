import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { loadPlugin } from "../dist/plugin-loader.js";
import * as marcUtils from "../dist/marcmap.js";
import { Transform } from "stream";
import fs from "fs";
import os from "os";
import path from "path";

const ctx = { utils: marcUtils };

describe("loadPlugin", () => {
    test("load unknown plugin throws error", async () => {
        await expect(loadPlugin("foobar", "input")).rejects.toThrow(Error);
    });
    test("load the demo plugin", async () => {
        const plugin = await loadPlugin("./plugin/demo.js","transform");

        expect(plugin).toBeDefined();

        const stream = await plugin.transform({}, ctx);

        expect(stream).toBeInstanceOf(Transform);
    });
    test("load the xml input plugin", async () => {
        const plugin = await loadPlugin("xml","input");

        expect(plugin).toBeDefined();

        const stream = await plugin.transform({}, ctx);

        expect(stream).toBeInstanceOf(Transform);
    });

    // Regression: when the cwd contains a directory whose name matches a
    // built-in plugin (e.g. a `fix/` dir alongside `--map fix`), path.resolve
    // hits that directory and import() throws ERR_UNSUPPORTED_DIR_IMPORT. The
    // loader must fall through to the built-in transform rather than aborting.
    describe("directory shadowing a built-in plugin", () => {
        const origCwd = process.cwd();
        let tmpDir: string;

        beforeAll(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-"));
            fs.mkdirSync(path.join(tmpDir, "fix"));
            process.chdir(tmpDir);
        });

        afterAll(() => {
            process.chdir(origCwd);
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        test("falls through to the built-in fix transform", async () => {
            const plugin = await loadPlugin("fix", "transform");

            expect(plugin).toBeDefined();
            expect(typeof plugin.transform).toBe("function");
        });
    });
});