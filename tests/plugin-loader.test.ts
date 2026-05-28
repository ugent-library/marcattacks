import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../dist/plugin-loader.js";
import * as marcUtils from "../dist/marcmap.js";
import { Transform } from "stream";

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
});