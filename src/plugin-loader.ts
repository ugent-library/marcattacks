export async function loadPlugin(
    spec: string, type: "input" | "output" | "transform"
) {
  // spec can be:
  //  - "./local/file.js"
  //  - "/absolute/path/to/plugin.js"
  //  - "package-plugin"
  //  - "package-plugin/submodule"

  try {
    return await import(spec);
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