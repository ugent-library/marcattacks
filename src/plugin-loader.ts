import path from "path";
import type { Transform } from "stream";
import { ExitCode } from "./exit-codes.js";

// A genuine "module could not be resolved" error. Node's native ESM loader
// uses ERR_MODULE_NOT_FOUND; Jest's resolver (and CommonJS) use MODULE_NOT_FOUND.
// Anything else means the file WAS found but failed to load.
function isModuleNotFound(e: any): boolean {
  return e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND';
}

// Attach a semantic exit code (read by classifyError in exit-codes.ts) so the
// CLI exits with the right status for this failure category.
function tag(e: any, exitCode: number): any {
  if (e && typeof e === 'object') e.exitCode = exitCode;
  return e;
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
    // The file was found but failed to load (SyntaxError, throwing top-level,
    // bad sub-import): a real internal/software error, not a usage mistake.
    if (!isModuleNotFound(e1)) throw tag(e1, ExitCode.SOFTWARE);
    try {
      const resolved = new URL(`./${type}/${spec}.js`, import.meta.url).href;
      return await import(resolved);
    } catch (e2) {
      if (!isModuleNotFound(e2)) throw tag(e2, ExitCode.SOFTWARE);
      try {
        // Bare specifier: an npm-package plugin ("pkg" or "pkg/submodule").
        return await import(spec);
      } catch (e3) {
        // Nothing resolved: the user named a plugin that does not exist.
        throw tag(new Error(
          `Cannot load plugin: ${spec}. Tried direct path, local ${type} directory, and bare package import.`,
          { cause: [e1, e2, e3] }
        ), ExitCode.USAGE);
      }
    }
  }
}