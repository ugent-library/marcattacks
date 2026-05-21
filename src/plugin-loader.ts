import path from "path";
import type { Transform } from "stream";

export async function loadPlugin(
    spec: string, type: "input" | "output" | "transform"
) : Promise<any> {
  // spec can be:
  //  - "./local/file.js"
  //  - "/absolute/path/to/plugin.js"
  //  - "package-plugin"
  //  - "package-plugin/submodule"

  try {
    const resolved = path.resolve(spec);
    return await import(resolved);
  } catch (e1) {
    try {
      const resolved = new URL(`./${type}/${spec}.js`, import.meta.url).href;
      return await import(resolved);
    } catch (e2) {
      const error = new Error(
        `Cannot load plugin: ${spec}. Tried direct import and local plugin directory.`
      );
      error.cause = [e1, e2];
      throw error;
    }
  }
}