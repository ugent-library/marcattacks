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
      try {
        // Bare specifier: an npm-package plugin ("pkg" or "pkg/submodule").
        return await import(spec);
      } catch (e3) {
        throw new Error(
          `Cannot load plugin: ${spec}. Tried direct path, local ${type} directory, and bare package import.`,
          { cause: [e1, e2, e3] }
        );
      }
    }
  }
}