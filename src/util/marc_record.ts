/**
 * Marker for record objects whose string values are already free of control
 * characters (\x00-\x1F and \x7F).
 *
 * Input readers that strip control characters while parsing (e.g. the XML
 * readers) set this on the records they emit. Output writers that would
 * otherwise re-strip every value (e.g. alephseq) can then skip that work.
 *
 * It is a Symbol so it never shows up in `JSON.stringify`, `Object.keys` or
 * `for...in` — outputs that serialise the whole record object (json, jsonl,
 * rdf) are unaffected. A transform that builds a new record object (e.g. a
 * JSONata `fix`) naturally drops the marker, so escaping is re-applied unless
 * cleanliness is re-asserted — a safe default.
 */
export const CLEAN: unique symbol = Symbol('marc.record.clean');

export type CleanFlag = { [CLEAN]?: boolean };
