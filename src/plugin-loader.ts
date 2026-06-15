import path from "path";
import type { Transform } from "stream";

// A genuine "module could not be resolved" error. Node's native ESM loader
// uses ERR_MODULE_NOT_FOUND; Jest's resolver (and CommonJS) use MODULE_NOT_FOUND.
// Anything else means the file WAS found but failed to load.
function isModuleNotFound(e: any): boolean {
  return e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND';
}

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
    // Only a genuine "module not found" justifies trying the next resolution
    // strategy. If the file WAS found but failed to load (SyntaxError, a
    // throwing top-level, a bad import inside it), retrying it as a local
    // transform or npm package is wrong and buries the real error in cause[0].
    if (!isModuleNotFound(e1)) throw e1;
    try {
      const resolved = new URL(`./${type}/${spec}.js`, import.meta.url).href;
      return await import(resolved);
    } catch (e2) {
      if (!isModuleNotFound(e2)) throw e2;
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