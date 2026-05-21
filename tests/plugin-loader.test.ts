import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../dist/plugin-loader.js";
import { Transform } from "stream";

describe("loadPlugin", () => {
    test("load unknown plugin throws error", async () => {
        await expect(loadPlugin("foobar", "input")).rejects.toThrow(Error);
    });
    test("load the demo plugin", async () => {
        const plugin = await loadPlugin("./plugin/demo.js","transform");

        expect(plugin).toBeDefined();

        const stream = await plugin.transform();

        expect(stream).toBeInstanceOf(Transform);
    });
    test("load the xml input plugin", async () => {
        const plugin = await loadPlugin("xml","input");

        expect(plugin).toBeDefined();

        const stream = await plugin.transform();

        expect(stream).toBeInstanceOf(Transform);
    });
});