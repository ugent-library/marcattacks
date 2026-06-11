# Code review: bugs and inefficiencies

Review date: 2026-06-11, against version 2.10.1 (commit d4f4c81).
Findings were verified against the source; the critical data-loss bugs were
reproduced empirically with the bundled sample data.

## Status

| Tier | Findings | Status |
| --- | --- | --- |
| Critical (data loss) | 1, 2, 3 | ✅ Fixed & verified |
| High | 4, 5, 6, 7, 8 | ✅ Fixed & verified |
| Medium | 9–19 | ✅ Fixed & verified |
| Low | various | ✅ Fixed & verified |

Fixed bugs were verified end-to-end: the data-loss bugs by re-running against
the bundled sample, and the S3/SFTP fixes against the `docker compose` MinIO and
SFTP services. Each fix that had a clear before/after was confirmed by stashing
the change and reproducing the original failure. Regression tests were added for
bugs 1, 2, 3, and 8.

## Critical — verified data loss

### 1. `src/input/marc.ts:16-19` — ISO2709 reader silently drops most records — ✅ FIXED

**Fix:** `flush()` now waits for the parser's `'end'` event before calling the
callback. Verified: the bundled `data/npr01.mrc` (135 records) now yields all
135 via the CLI (was 5). The same defensive fix was applied to the latent twin
in `src/input/json.ts`. Regression test strengthened in
`tests/input/marc.test.ts` (asserts the exact record count, not just `> 0`).

`flush()` calls `parser.end()` and then `callback()` immediately, but marcjs's
`Iso2709Parser` drains its internal queue asynchronously (one record per
`setImmediate` tick). Everything still queued when the outer Transform ends is
lost.

```js
flush(callback: TransformCallback) {
    parser.end(); //
    callback();
}
```

**Reproduced:** `data/npr01.mrc` contains **135** records (counted by `0x1D`
separators), but

```
node dist/command.js --from marc --to jsonl data/npr01.mrc | wc -l
```

emits only **5** — 130 records silently dropped, no error. The count is
timing-dependent (another run delivered 61).

**Fix:** wait for the parser's `'end'` event before invoking the flush
callback, as `src/input/rdf.ts:62-72` and `src/output/csv.ts:51-58` already do.

Note: `src/input/json.ts:13-16` has the same `end()`-then-`callback()` pattern.
It happens to work today because stream-json emits synchronously on write, but
it is the same latent bug.

### 2. `src/input/jsonl.ts:13` and `src/input/tsv.ts:16` — UTF-8 corruption at chunk boundaries — ✅ FIXED

**Fix:** both readers now use a `StringDecoder("utf8")` (matching `alephseq.ts`),
decoding `decoder.write(chunk)` per chunk and flushing `decoder.end()` into the
tail at flush. Verified: a buffer split between the two bytes of `é` decodes to
`café résumé` (was `caf��`). Regression tests added to
`tests/input/jsonl.test.ts` and `tests/input/tsv.test.ts`.

Both do `(tail + chunk.toString()).split(/\r?\n/)` with no `StringDecoder`, so
a multi-byte character straddling a 64 KB read boundary decodes as two U+FFFD
replacement characters.

**Reproduced:** feeding a JSONL line split inside `é` yields
`{"name":"caf�� résumé"}`.

On any large non-ASCII input this is essentially guaranteed to hit.
`src/input/alephseq.ts:17` and `src/input/fastxml.ts:86` already use
`StringDecoder` for exactly this reason — copy that.

### 3. `src/input/tsv.ts:47-53` — flush parses the trailing TSV line as JSON — ✅ FIXED

**Fix:** the line-parsing logic was extracted into a shared `processLine` helper
used by both `transform` and `flush`, so the trailing newline-less row is parsed
as TSV instead of JSON. Verified by a regression test ("emits a final row with
no trailing newline") in `tests/input/tsv.test.ts`.

Copy-pasted from the jsonl reader. A file whose final row lacks a trailing
newline ends up in `tail`; flush runs `JSON.parse(tail)`, which throws on any
normal TSV row and is swallowed — the last record of the file silently
disappears.

```js
flush(callback) {
    if (tail.trim()) {
        try {
            this.push(JSON.parse(tail));
        } catch (e) { /* ignore trailing whitespace */ }
    }
```

## High

### 4. `src/stream/s3stream.ts` — multipart uploads never aborted on failure

**Fix:** imported `AbortMultipartUploadCommand`; added an `abortUpload()` helper
wired into the `write`/`final` error paths and a new `destroy()` handler, plus a
`completed` flag so a successfully completed upload is never aborted. Verified
against MinIO with a deterministic test (confirm the upload exists mid-flight via
`ListMultipartUploadsCommand`, destroy, then poll): original code leaves an
orphaned multipart upload; fixed code aborts it cleanly. Normal multipart
round-trips still complete.

`AbortMultipartUploadCommand` is not imported anywhere, and the Writable has no
`destroy()` handler. Any error or mid-stream pipeline teardown after
`CreateMultipartUpload` orphans the upload on the server; storage costs accrue
until a lifecycle rule cleans it up.

### 5. `src/stream/sftpstream.ts:48,83` — connection errors after stream handoff are swallowed — ✅ FIXED

**Fix:** both `sftpReadStream` and `sftpWriteStream` now track the handed-out
stream; before handoff a connection error rejects the promise, after handoff it
is forwarded to the live stream via `stream.destroy(err)`. Verified against the
Docker SFTP service: read round-trip delivers all 1000 records, and a wrong
password still exits non-zero (code 8).

```ts
conn.on("error", (err) => reject(err));
```

Once `resolve(stream)` has run, this `reject` is a no-op on a settled promise.
A dropped SSH connection mid-transfer never reaches the consumer, so the
pipeline hangs or silently truncates. Affects both `sftpReadStream` and
`sftpWriteStream`. **Fix:** call `stream.destroy(err)` on the handed-out
stream once it exists.

### 6. `src/stream/filestream.ts:29-31,56-57` — `throw` inside the `fs.readdir` callback — ✅ FIXED

**Fix:** `fileLatestFile`'s promise now takes a `reject` parameter; both throws
were replaced with `reject(...)`, and the readdir error is chained via
`{ cause: err }`. Verified: resolving `@latest:` against a non-existent directory
now rejects cleanly (`Error finding latest file`, cause `ENOENT`) with the
process staying alive, instead of crashing with an uncaughtException.

The wrapping promise has no `reject` parameter at all; a throw in the async
callback is an uncaughtException (process abort) and the promise never
settles. (`fileGlobFiles` at lines 85-89 in the same file does it correctly
with `reject`.) Also `new Error("...", err)` misuses the options argument —
should be `{ cause: err }`.

### 7. `src/output/rdf.ts:16-48` and `src/transform/marcinrdf.ts:17-27` — unguarded `await` in async `transform()` — ✅ FIXED

**Fix:** both async `transform()` bodies are now wrapped in try/catch routing any
error to `callback(err)`. Verified: a JSON-LD record with an unregistered remote
`@context` went from **exit 1 with an unhandled rejection** (original) to a clean
**exit 3 pipeline error** (fixed).

Node streams ignore the promise returned by an async `transform()`. A rejected
await (e.g. the deliberate throw in `src/util/jsonld.ts:28-36` for an
unregistered remote `@context`, reachable from `await parseJsonLd(data)`)
becomes an unhandled rejection — a process crash instead of a pipeline error —
and `callback` is never invoked. `src/transform/jsonata.ts:85-93` and
`src/transform/fix.ts:91-99` wrap correctly; these two need the same
treatment.

### 8. `src/command.ts:225` — `--param key=value` truncates values containing `=` — ✅ FIXED

**Fix:** `collect()` now splits on the first `=` only (`indexOf("=")` + slice).
Verified via CLI: `--param 'fix=add_field("flag","a=b=c")'` yields
`flag = "a=b=c"` (was `"a"`). Regression test added to `tests/command.test.ts`.

```js
const keyval = value.split("=",2);
```

JS `split` with a limit discards the remainder (unlike Perl), so
`-p 'fix=set(x,a=b)'` stores `"set(x,a"`. Any param value containing `=`
(jsonata expressions, fix snippets, query strings) is corrupted. **Fix:**
`indexOf("=")` + slice.

## Medium

### 9. `src/attacker.ts:91,99` — `.tgz` untarred but never gunzipped; untar regex over-matches — ✅ FIXED

**Fix:** `createDecompressionStage` now also triggers for `.tgz` (gunzip), and the
untar regex was corrected to `/\.tar(\.\w+)?$/` (escaped dots). Verified: a real
`.tgz` of `data/sample.xml` now reads 1000 records with no extra flags.

`"file.tgz".endsWith(".gz")` is false, so a `.tgz` input activates the untar
stage but feeds it raw gzip bytes — failing unless the user also passes `--z`.
Additionally the dots in `/.tar(.\w+$)?$/` are unescaped wildcards, so
`guitar.xml`, `nectar.json`, etc. are falsely untarred. Should be
`/\.tar(\.\w+)?$/`.

### 10. `src/util/stream_helpers.ts:217-231` — untar buffers each tar entry fully in memory — ✅ FIXED

**Fix:** each tar entry chunk is now pushed straight through as raw bytes (no
whole-entry `Buffer.concat`, no `toString('utf-8')`), so memory stays bounded and
binary/MARC-8 entries are no longer corrupted. Downstream readers decode bytes
themselves (they use `StringDecoder` after the critical-tier fix). The push
follows the same flow as the marc parser; strict readable-side backpressure is
not added (matching existing design).

Each entry is accumulated into a `Buffer.concat` and pushed as one giant UTF-8
string; `push()`'s return value is ignored so downstream backpressure never
reaches the extractor. A multi-GB file inside a tar defeats the streaming
design entirely, and `toString('utf-8')` would corrupt binary (e.g. MARC-8)
entries.

### 11. `src/transform/avram.ts:30-32` — all control fields emitted as `LDR` — ✅ FIXED

**Fix:** control fields now emit `{ tag, value: data }` (their own tag), and the
destructive `field.splice(3)` was changed to `field.slice(3)` so input rows are
not mutated. The existing test encoded the buggy behavior — it was updated, and a
non-mutation regression test was added (`tests/transform/avram.test.ts`).

```js
else if (tag.startsWith('00')) {
    avram.fields.push({ tag: 'LDR' , value: data });
}
```

001/003/005/008 are all indistinguishable from the leader in parquet output.
Should be `{ tag, value: data }`. (Also: line 25 `field?.splice(3)`
destructively mutates the input record rows.)

### 12. `src/transform/marc2rdf.ts` — dead guards and malformed IRIs — ✅ FIXED

**Fix:** `id` now takes `marcmap(...)[0]` and skips records without a 001
(`return []`); the `name` guard checks `name.length === 0`; the `bibo:Document`
IRI lost its trailing spaces; and `contentUrl` was moved from the RDF-syntax
namespace to `schema:`. Verified: a record without 001 produces no quads, the
normal demo still emits quads, and `22-rdf-syntax-ns#contentUrl` no longer
appears in the output.

- Lines 36-38 and 62-67: `marcmap`/`marcsubfields` return arrays, so
  `if (!id) return` / `if (!name) return` never fire (`[]` is truthy). A
  record with no 001 mints the subject `https://lib.ugent.be/record` (empty
  id); two 001 fields produce `record/id1,id2`. Check `.length` instead.
- Line 331: `` `${prefixes.bibo}Document  ` `` mints an IRI with trailing
  spaces.
- Lines 276-280: `contentUrl` is minted in the RDF-syntax namespace
  (`rdf:contentUrl`) while every sibling property uses `prefixes.schema`.

### 13. `src/output/tsv.ts:43-44` and `src/output/multipart.ts:41-42` — `null` field values crash the run — ✅ FIXED

**Fix:** both writers now special-case `null`/`undefined` (emit an empty field)
before the `typeof === 'object'` branch. The tsv writer additionally neutralises
tab/CR/LF in scalar values so they can't corrupt the row structure. Verified: a
record with a `null` value writes cleanly (exit 0) instead of throwing.

`typeof null === 'object'` and it isn't an array, so `Object.keys(null)`
throws `TypeError`. Any record with a null value (trivially produced by a
fix/jsonata map) kills the whole pipeline. The tsv writer also writes values
containing tabs/newlines unescaped, corrupting the row structure (the csv
writer is safe via csv-stringify).

### 14. `src/command.ts` + `src/util/stream_helpers.ts:70` — `--count`/`--skip` never parsed to numbers — ✅ FIXED

**Fix:** both options got a `parseInt(value,10)` parser (like `--log-every`), so
they arrive as numbers and the strict-equality "close at record N" path works.
Verified: `--count 2` emits exactly 2 records.

Unlike `--log-every`, these options have no parser, so they arrive as strings
and the strict-equality "close exactly at record N" check
(`pushed === count`) never fires. The limiter only stops via the coercing
`pushed >= count` guard, which requires record N+1 to arrive — on a
slow/stalled source, `--count N` waits indefinitely instead of closing at N.

### 15. `src/stream/s3stream.ts` — quadratic buffering, spurious empty part, undecoded credentials — ✅ FIXED

**Fix:** the writer now accumulates chunks in an array and concatenates once per
part (no O(n²) re-copy); `flushPart` returns early on an empty buffer so no 0-byte
trailing part is uploaded and the empty-stream `PutObject` path is reachable; and
URL credentials are `decodeURIComponent`-ed in both `parseURL` (S3) and
`makeSftpConfig` (SFTP, where the dead `Number(port) ?? 22` was also corrected).
Verified against MinIO: empty stream → 0-byte object with no orphan upload; exact
10 MB → 2 clean parts, no spurious empty part; round-trip intact.

- Line 153: `buffer = Buffer.concat([buffer, chunk])` re-copies up to 5 MB per
  16-64 KB chunk (O(n²) per part). Accumulate chunks in an array and concat
  once in `flushPart`.
- Lines 189-207: `flushPart(true)` falls through with an empty buffer, so when
  total bytes are an exact multiple of the part size an extra 0-byte part is
  uploaded (some S3-compatible stores reject this), and the empty-object
  `PutObject` path in `finishUpload` is unreachable.
- Lines 474-480: URL-embedded credentials are not `decodeURIComponent`-ed;
  AWS secret keys containing `/` or `+` must be percent-encoded in the URL and
  are then passed encoded to the SDK, causing signature failures. The same
  decode issue exists for username/password in `sftpstream.ts:268-273`.

### 16. `src/stream/httpstream.ts` — redirect and socket handling — ✅ FIXED

**Fix:** `httpReadStream` now caps redirects (`MAX_REDIRECTS = 10`), resolves the
`Location` header relative to the current URL (`new URL(loc, url)`), drains the
response body (`res.resume()`) on both error and redirect responses, and uses
shared module-level keep-alive agents instead of per-call ones. Verified: reading
`http://localhost:8080/sample.xml` from the Docker nginx returns 1000 records.

- Lines 36-40: unbounded redirect recursion — no hop limit, so a redirect loop
  recurses forever.
- Line 38: relative `Location:` headers throw `ERR_INVALID_URL` outside any
  try/catch (uncaught exception). Should be `new URL(location, url)`.
- Lines 29-41: on 4xx/5xx and redirects the response body is never drained or
  destroyed, pinning the keep-alive socket.
- Lines 14-15: new keep-alive agents are created per call (and per redirect
  hop), defeating connection reuse — contrast `s3stream.ts:37-38`, which
  shares agents at module level.

### 17. `src/plugin-loader.ts:7-19` — npm-package plugins can never load — ✅ FIXED

**Fix:** a third attempt — a bare `import(spec)` — was added after the path and
local-plugin-dir attempts, so npm-package plugins (`pkg` / `pkg/submodule`) now
load. The fallback error now carries all three underlying errors via
`{ cause: [e1, e2, e3] }`.

`path.resolve("package-plugin")` turns the documented bare specifier into a
CWD path, which fails; a bare `import(spec)` is never attempted, so both
documented package forms are unreachable. Secondary: when a local plugin file
exists but throws, the real error is buried in `error.cause` behind a generic
"Cannot load plugin" message.

### 18. `src/globber.ts:83` — default log level `"off"` suppresses crash output — ✅ FIXED

**Fix:** both logger configs in globber now default to `level: "error"` (matching
`command.ts`), so crashes surface. The unsupported-scheme branch now logs the
error and sets `process.exitCode = 4` instead of falling through to exit 0.

`command.ts` uses `"error"` here; globber's `"off"` means a crash (invalid
URL, sftp auth failure) exits with code 4 and no output at all unless
`--info/--debug/--trace` was passed. Also, unsupported URL schemes (lines
145-147) print to console.error but exit 0.

### 19. `src/attacker.ts:292-307` — resources leak when no output transform exists — ✅ FIXED

**Fix:** when there is no output transform, an `else` branch now destroys every
already-created stage (input stream, decompression/untar, and any spawned worker
pool), so handles are released and the worker threads don't keep the event loop
alive.

If `opts.to` is falsy (programmatic use; the CLI default `'json'` masks it),
the input read stream, decompression stage, and a fully spawned worker-thread
pool are created but never run and never destroyed — the workers keep the
event loop alive and `attack()` silently returns 0. Likewise, if output-stage
creation throws, already-built stages (including spawned workers) are not torn
down.

## Low — ✅ FIXED (one deferred, noted below)

- ✅ **`src/stream/slow-writable.ts`** (`--out @errors`): rewrote so each write
  callback is invoked exactly once and the redundant manual `emit('error')` was
  removed (the simulated-error path no longer risks ERR_MULTIPLE_CALLBACK).
  In-flight delayed writes are now tracked in a set so `_destroy` cancels their
  timers, errors their callbacks once, and settles their promises. The 4
  slow-writable tests still pass.
- ✅ **`src/stream/worker-pool.ts:192-196`**: each worker's `stdout`/`stderr`
  readables are now drained with `.resume()`, so a chatty plugin can't grow them
  without bound.
- ⏸ **`src/util/stream_helpers.ts:111-115`** (the fixed 2-second stdout teardown):
  **deliberately not changed.** The 2 s margin guards against truncating stdout —
  at teardown time the downstream chain may still be flushing the last records to
  stdout, and stdout never emits `'finish'`. Reducing it safely needs tracking
  the full downstream flush, which is out of scope for a latency nit and risks
  cutting output. Left as-is.
- ✅ **`src/stream/filestream.ts:36,98`**: both `new URL("file://" + path)` sites
  now use `pathToFileURL()`, which percent-encodes `#`, `%`, spaces, etc.
  Verified: a file named `with space.xml` resolves to `…/with%20space.xml`.
  (The one-time `statSync` directory scan was left — it is not on the hot path.)
- ✅ **`src/output/xml.ts:45,47`**: the datafield `tag` and subfield `code`
  attributes are now escaped with `{forAttribute:true}`.
- ✅ **`src/input/fastxml.ts:105-107`**: the keep-tail now retains everything from
  the last `<` (any partial open tag) instead of a fixed 64 chars, so a long
  `<record …>` spanning a chunk boundary is no longer truncated.
- ✅ **`src/input/xml.ts:73-79`**: removed the `throw err` after
  `transformStream.destroy(err)`. Verified: malformed XML now exits 3 (clean
  pipeline error) instead of throwing an uncaught exception out of
  `parser.write`.
- ✅ **`src/input/jsonl.ts`**: a malformed (non-whitespace) final record now
  errors the callback like the mid-file handler, instead of being swallowed.
- ✅ **`src/attacker.ts:348-353`**: `isReaderClosedPipe` now also matches
  `ECONNRESET` (code and message), as its comment always claimed.
- ✅ **`src/util/rdf_parse.ts` `parseStreamAsParts`**: reworked from a manual
  `push()` into a `Transform` fed by `rdfParser.parse(...).pipe(output)`, so
  backpressure from a slow downstream propagates to the parser instead of
  buffering the whole parse output. Verified via the RDF round-trip and the
  existing rdf tests.
- ✅ **`src/util/rdf_parse.ts` `writeString`**: the `if (!quads)` guard moved
  before `quads.length` is read and now `return`s.
- ✅ **`src/transform/marcinrdf.ts`**: replaced the per-record `structuredClone`
  with a shallow copy and changed `splice(1)`→`slice(1)` in
  `serializeFieldRecord` so the shared rows aren't mutated. (No test added, per
  request; verified by running the `text:field` demo.)
- ✅ **`src/marcmap.ts:116`**: hot-path `row[i]?.match(re)` → `re.test(...)` (no
  per-subfield match-array allocation; callers use non-global regexes so
  `test()` is stateless).

## Clean

`src/worker.ts` and `src/stream/worker-pool.ts` ordering, backpressure, and
end semantics check out, as do `src/input/alephseq.ts`, the csv reader/writer,
`fix.ts`/`jsonata.ts` (expressions compiled once, errors routed to
`callback(err)`), `parquet.ts`, `xml_escape.ts`, and `marcmap.ts` (the
`findCache` regex cache works).

## Remaining work

All tiers — critical (#1–#3), high (#4–#8), medium (#9–#19), and low — are fixed
and verified, with one deliberate exception: the fixed 2-second stdout teardown
in `stream_helpers.ts` (see the Low section for why it was left as-is). The
low-tier SFTP `Number(port) ?? 22` issue was folded into the #15
credential-decoding fix.

## `.env` credential precedence — ✅ FIXED

While testing the S3 fixes against local MinIO, CLI writes failed with "Access
Key Id you provided does not exist" even though the `s3://user:pass@…` URL had
valid credentials. Root cause: `command.ts` loads `.env` from the cwd by default
(`dotenv.config`), and the `S3_ACCESS_KEY`/`S3_SECRET_KEY` (and SFTP equivalents)
**unconditionally overrode** the credentials embedded in the URL.

**Fix:** the precedence was reversed in all five override sites
(`src/attacker.ts` input S3/SFTP and output S3/SFTP, `src/globber.ts` S3 glob):
the env var is now only used as a fallback (`if (!url.username && process.env…)`)
when the URL omits the credential. Verified: with a conflicting env credential
(`-c` pointing at an env file with a wrong key), the original code fails with
"Access Key Id does not exist" while the fixed code uses the URL credential and
succeeds. Docs updated (`README.md`, `README-docker.md`).
