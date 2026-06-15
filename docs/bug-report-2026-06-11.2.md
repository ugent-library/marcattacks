# Code review: bugs and inefficiencies (second pass)

Review date: 2026-06-11, against commit a50e5cc ("Fix bugs and inefficiencies
from code review").

This is a follow-up to [bug-report-2026-06-11.md](bug-report-2026-06-11.md),
which is fully addressed by commit a50e5cc. This pass looked for issues the
first review missed and for regressions introduced by those fixes. Nothing
from the first report is repeated here. The high-severity findings were
verified empirically against the built code.

## Status

| Tier | Findings | Status |
| --- | --- | --- |
| Failing test | fan-out coverage | ✅ Fixed |
| High | 1–3 | ✅ Fixed |
| Medium | 4, 5, 6, 7, 8, 9, 10 | ✅ Fixed |
| Low | all | ✅ Fixed (except slow-writable dead code, left deliberately) |

## Root cause of the failing `worker-pool.test.ts` — ✅ FIXED

The fan-out test failed because commit `8e122ba` ("revert z00r.js to simple
serial version") reverted the plugin but not the test. The test pointed at
`plugin/z00r.js` and needed it to export `createMapper`/`fanOut` (added in
`8838df1`); the revert removed them, and `src/worker.ts:17-19` correctly
refuses a map without `createMapper`. The fan-out machinery itself is still
shipped code (`worker-pool.ts`, `attacker.ts` reads `mod.fanOut`) and this
test was its only coverage.

**Fix applied:** rather than re-add fan-out to `z00r.js` (kept deliberately
serial/simple), a dedicated fan-out demo plugin `plugin/explode.js` was added —
it explodes each MARC record into one row per field and exports
`fanOut`/`autoParallel`/`createMapper`/`transform`. The test now points at it,
and a `demo:explode` npm script was added. Verified: the full suite is green
(139/139), and `--map ./plugin/explode.js` produces identical, order-preserved
output on the serial (`--workers 1`) and threaded (`--workers 4`/`auto`) paths
(19939 rows from the sample either way). `plugin/z00r.js` was not touched.

## High

### 1. `src/input/marc.ts:34` — ISO2709 control fields lose their values in every conversion — ✅ FIXED

**Fix:** control fields are now pushed as `[tag, ' ', ' ', '_'].concat(data)`, so
the value sits at index 4 behind the `'_'` code placeholder, matching the LDR row
and every other reader. Verified: `--from marc` now carries 001/003/005/008
values through to jsonl (`["001"," "," ","_","FRNPHMED138013"]`), alephseq (the
`001` line and record ids are populated) and xml (`<controlfield>` has its
value). Regression assertion added to `tests/input/marc.test.ts`.

Control fields are pushed as `[tag, ' ', ' ', value]` — missing the `'_'` code
placeholder at index 3 that every other reader emits (`xml.ts:57`,
`fastxml.ts:69`, alephseq; the LDR row in this same file does it correctly at
line 29):

```js
if (field.length == 2 && tag.startsWith("00")) {
    ...
    const data = field.slice(1);
    rec.push([tag, ind1, ind2].concat(data));
```

Everything that walks subfields as (code@3, value@4) pairs — `marcmap`/
`marcsubfields`, the alephseq/xml writers, avram, fixes — sees the value as a
*code* with no value.

**Reproduced:**
- `--from marc --to jsonl data/npr01.mrc` emits
  `["001"," "," ","FRNPHMED138013"]` (value in the code slot);
- `--from marc --to alephseq` writes an **empty** `001 L` line;
- `--from marc --to xml` writes `<marc:controlfield tag="001"></marc:controlfield>`.

All 001/003/005/008 values silently vanish from ISO2709 input. **Fix:**
`rec.push([tag, ind1, ind2, '_'].concat(data))`. Pre-existing (not a
regression); missed last pass because the flush data-loss bug dominated this
file's inspection.

Severity: high. Confidence: certain (reproduced).

### 2. `src/stream/worker-pool.ts` — `destroy()` does not terminate worker threads (bug #19's fix is ineffective for the worker pool) — ✅ FIXED

**Fix:** added a `destroy(err, cb)` handler to the pool Transform that sets
`closing = true`, clears the per-batch timers, and `Promise.all`-terminates all
workers before calling back. It is idempotent with `finish()`/`fail()` (which
already terminate on their paths) and covers external `destroy()`, upstream
pipeline errors, and the no-output-transform teardown. Verified: after
`pool.destroy()` the `'close'` event fires and the process exits on its own
(workers gone); threaded runs still complete (19939 rows from the sample); full
suite green.



The pool Transform has no `_destroy`/`'close'` handler; workers are only
terminated inside `fail()` and `finish()`, which are reached via
`_transform`/`_flush` — never via `stream.destroy()`. The first-pass fix for
#19 does exactly this:

```ts
for (const stage of stages) {
    try { (stage as any).destroy?.(); } catch { /* best effort */ }
}
```

**Reproduced:** a process that creates a pool (`workers: 2`) and calls
`pool.destroy()` stays alive indefinitely — the workers pin the event loop.
Consequences: the no-output-transform teardown still leaks N live threads
(the exact symptom #19 described), and any `pipeline()` error leaks them in
programmatic use (`pipeline` destroys the pool stage without terminating
workers; the CLI is masked only by `process.exit`).

**Fix:** add a `destroy(err, cb)` option (or `'close'` listener) that clears
the pool's timers and runs `Promise.all(workers.map(w => w.terminate()))`.

Severity: high. Confidence: certain (reproduced).

### 3. `src/stream/s3stream.ts:194-219` — `destroy()` racing an in-flight first `write()` re-creates an orphaned multipart upload — ✅ FIXED

**Fix:** added an `aborted` flag (set by `abortUpload()`) that `ensureUpload()`
checks immediately after `CreateMultipartUpload` resolves — if teardown landed
while the create was in flight, it aborts the just-created upload and throws, so
nothing is orphaned; `flushPart()` also bails when `aborted`. A `completing`
flag guards the narrower S3-2 race: `abortUpload()` skips while a
`CompleteMultipartUpload` is in flight (no concurrent Abort+Complete on the same
uploadId), and `completing` is cleared in a `finally` so a *failed* Complete can
still be aborted by the final/destroy catch. Verified against MinIO: round-trip
and empty-object paths unchanged, and `destroy()` at every delay from 0–40 ms
after a 6 MB write leaves **zero** orphaned uploads.



`abortUpload()` only acts when `uploadId` is already set:

```ts
async function abortUpload() {
    if (uploadId && !completed) { ... }
}
```

Node invokes `_destroy` immediately on `stream.destroy()` without waiting for
an in-flight `_write`. If teardown lands while the first part's
`CreateMultipartUpload` is still in flight inside `ensureUpload()`, the abort
no-ops (`uploadId` is null), then the create resolves and `UploadPart` runs —
leaving a freshly created upload that nothing will ever abort. This is the
orphan-upload scenario the first-pass fix #4 was meant to close; the
interleaving (`create-start → abort no-op → create-done → uploadPart`) was
reproduced with a mock. A narrower variant: `destroy()` while `final()` is
awaiting `CompleteMultipartUpload` sends a concurrent Abort (AWS documents
that race as indeterminate).

**Fix:** set an `aborted`/`destroyed` flag in `abortUpload()` and have
`ensureUpload()`/`flushPart()` throw or no-op when it is set.

Severity: high. Confidence: certain (interleaving reproduced).

## Medium

### 4. `src/stream/httpstream.ts:49` — a malformed `Location` header is still an uncaughtException — ✅ FIXED

**Fix:** the entire `client.get` response callback is now wrapped in its own
try/catch that drains the body (`res.resume()`) and `reject`s. `new URL(loc,
url)` on an invalid `Location` (`http://`, `https://%`, spaces) — and any other
throw in the callback — now rejects the promise instead of escaping as an
uncaughtException. Verified end-to-end: a 302 with `Location: http://` now
rejects cleanly with "Invalid URL" (no uncaughtException); redirects and
normal responses are unchanged; full suite green.

The first-pass fix #16 resolves *relative* locations, but `new URL(loc, url)`
still throws for *invalid* ones (`Location: http://`, `https://%`, URLs with
spaces), and the call runs inside the `client.get` response callback — after
the surrounding try/catch has exited (it only guards the synchronous setup).

**Reproduced end-to-end:** a 302 response with `Location: http://` crashes
the process with an uncaughtException instead of rejecting the promise.

**Fix:** wrap the redirect block (or the whole response callback) in its own
try/catch that calls `reject`.

Severity: medium-high. Confidence: certain (reproduced).

### 5. `src/attacker.ts:366` — input-side ECONNRESET is misclassified as "reader closed the pipe" (regression interaction) — ✅ FIXED

**Fix:** ECONNRESET was removed from `isReaderClosedPipe` (it now matches only
EPIPE / ERR_STREAM_DESTROYED — the genuine stdout-reader-gone signals). The
benign case it used to cover — a deliberate `--count` teardown destroying a
network input mid-read (which surfaces as ECONNRESET "aborted") — is now handled
explicitly: the count limiter exposes a `limitReached` flag, and `attack()`
checks it *before* the reader-disconnect heuristic, treating a post-limit
rejection as an expected stop. A real input failure with no count-stop now falls
through to the error branch.

**Verified (this is the load-bearing part):**
- `--count 5` over HTTP and over a 1.6 GB S3 object both emit exactly 5 records,
  stop in ~3 s without downloading the rest, and log "stream closed by limiter
  (count reached)" — for stdout pipes, file sinks, and with `--workers 4` + a
  real jsonata fix.
- A real input failure (HTTP server killed mid-download, no `--count`) now exits
  non-zero with a logged error ("pipeline closed prematurely" / "process stopped
  prematurely") instead of the previous silent code-0 reader-disconnect.
- The genuine stdout reader-disconnect (`| head`) path still works (EPIPE);
  full suite green (139/139).



```ts
if (e.code === 'EPIPE' || e.code === 'ECONNRESET' || e.code === 'ERR_STREAM_DESTROYED') return true;
```

The low-tier fix added ECONNRESET to `isReaderClosedPipe` at the same time
fix #5 made SFTP/HTTP *read* streams forward dropped-connection errors. A
mid-download network reset now classifies as a benign pager-quit:
`restoreTerminalAndDie()` → SIGKILL → no error message, truncated output,
and a "success-looking" shutdown for a real network failure. The check cannot
distinguish output-socket resets from input-connection resets. (Pre-existing
sibling: `ERR_STREAM_DESTROYED` in the same list conflates any internal
write-after-destroy with reader disconnect.)

**Fix direction:** scope the heuristic to errors originating from the output
sink (e.g. tag the sink's errors, or check `err` identity against the sink),
rather than matching codes anywhere in the chain.

Severity: medium. Confidence: likely.

### 6. `src/attacker.ts` — the "output-stage creation throws" half of #19 is still open — ✅ FIXED

**Fix:** the `stages` array is now declared *outside* the `try`, and the outer
`catch` destroys every already-built stage (best-effort, idempotent) before
rethrowing. A throw from `createOutputTransformStage`/`createOutputWriteStream`
(bad `--to` plugin, invalid `--out` URL, S3/SFTP connect failure) — or anywhere
in assembly — now tears down the input read stream, decompression stages, and a
spawned worker pool instead of leaking live threads. This also replaces the dead
`if (e instanceof PipelineError) { throw e } else { throw e }` catch (a low-tier
finding). Verified: full suite green (146/146), threaded runs still complete.

The new teardown is only an `else` branch on falsy `opts.to`. If
`createOutputTransformStage` or `createOutputWriteStream` *throws* (bad `--to`
plugin, invalid `--out` URL, S3/SFTP connect failure), the exception
propagates out of `attack()` and no already-built stage — including a spawned
worker pool — is destroyed.

**Fix:** wrap stage assembly in try/catch and destroy `stages` before
rethrowing. (Becomes fully effective only together with finding 2.)

Severity: medium. Confidence: certain.

### 7. `src/stream/filestream.ts` — statSync throw in callback; percent-encoded paths used as fs paths — ✅ FIXED

**Fix:**
- The `fs.statSync` call is now wrapped in a try/catch that logs at debug and
  `continue`s past the entry — a dangling symlink or a file deleted between
  readdir and stat no longer throws an uncaughtException from inside the
  callback; the scan proceeds over the remaining files.
- `directory` for both `fileLatestFile` and `fileGlobFiles` is now derived via
  `fileURLToPath(url.href.replace(/@(latest|glob):.*/, ""))` instead of the raw,
  percent-encoded `url.pathname`. A directory with a space (`/tmp/ma test dir/`)
  or a literal `%` is passed to `fs` decoded (no ENOENT, no double-encoding),
  and Windows `/C:/…` pathnames resolve correctly. Verified: globbing
  `file:///tmp/ma test dir/@glob:.xml` now returns
  `file:///tmp/ma%20test%20dir/a.xml` (previously ENOENT); full suite green.

- Line 41: `fs.statSync(directory + files[i])` sits inside the `fs.readdir`
  callback — the identical uncaughtException failure mode as the freshly
  fixed #6, one line below it. Realistically reachable: `statSync` on a
  dangling symlink throws ENOENT, as does a file deleted between readdir and
  stat. **Reproduced.** Wrap in try/catch → `reject` (or use
  `withFileTypes`/async stat).
- Lines 22, 40-41, 83, 102: `directory` comes from the percent-encoded
  `url.pathname`, so a directory containing a space yields
  `/tmp/ma%20test%20dir/` and `fs.readdir` fails ENOENT; a directory with a
  literal `%` gets **double-encoded** by the new `pathToFileURL` call. The
  first-pass fix encoded the output side but the input side needs
  `fileURLToPath` on the stripped URL (which would also handle Windows
  `/C:/…` pathnames). **Reproduced.**

Severity: medium. Confidence: certain (both reproduced).

### 8. `src/input/fastxml.ts:111-114` — keep-tail grows unboundedly on input with no `<` — ✅ FIXED

**Fix:** when the buffer has no `'<'` at all, the keep-tail now resets to `''`
(`buf = lt >= 0 ? buf.slice(lt) : ''`) instead of retaining the whole buffer —
nothing without a `'<'` can start a record. Verified: 20 MB of `<`-free input
now holds at ~6.7 MB heap (was ~158 MB) and exits with zero records; real
MARCXML still parses fully (1000 records), and a long `<record …>` open tag
split across a chunk boundary is still parsed correctly.



Regression-adjacent to the first-pass low-tier fix:

```js
const lt = buf.lastIndexOf('<');
buf = lt >= 0 ? buf.slice(lt) : buf;
```

When the buffer contains no `'<'` at all (garbage/binary input, a gzip fed
without `--z`, JSONL routed to `--from fastxml` by mistake), the entire input
accumulates in `buf`, and `buf += decoder.write(chunk)` re-copies the growing
string per chunk (O(n²) time on top of O(n) memory). **Measured:** 10 MB of
`<`-free input → 158 MB heap, then exit 0 with zero records and no
diagnostic.

**Fix:** `buf = lt >= 0 ? buf.slice(lt) : '';` (nothing before the last `'<'`
can start a record when no open tag is pending); optionally cap the retained
tail and error on un-XML-like input.

Severity: medium. Confidence: certain (measured).

### 9. `src/command.ts:21` — `--fix <what>` is a dead option (silent no-op) — ✅ FIXED

**Fix:** after parsing, `command.ts` now wires `opts.fix` into `opts.param.fix`
(where the map plugins read it), so `--fix <what>` is a working shorthand for
`--param fix=<what>`; an explicit `-p fix=` takes precedence if both are given.
Verified: `--fix ./demo/example.fix --map fix` produces output identical to
`--param fix=./demo/example.fix`, and `-p fix=` wins when both are passed.



`.option('--fix <what>','jsonata')` — `opts.fix` is never read anywhere.
Worse: with `--fix file.jsonata` and no `-p fix=`, jsonata's `isPassthrough`
returns true, the map stage is skipped entirely, and records pass through
unmapped with no warning. **Fix:** wire `opts.fix` into `opts.param.fix`, or
drop the option.

Severity: medium. Confidence: certain.

### 10. `src/plugin-loader.ts` — a broken local plugin file surfaces as a confusing 3-way failure — ✅ FIXED

**Fix:** each `import` attempt now rethrows immediately unless the error is a
genuine "module not found" (`ERR_MODULE_NOT_FOUND` from Node's ESM loader, or
`MODULE_NOT_FOUND` from Jest's resolver / CommonJS — both recognised by a shared
`isModuleNotFound` helper). A `SyntaxError`, a throwing top-level, or a bad
sub-import in a file that *was* found now surfaces as itself instead of being
retried as a local transform / npm package and buried in `cause[0]`. Verified:
a plugin with a syntax error now reports `SyntaxError: Unexpected end of input`
directly; a genuinely-missing plugin still falls through to the 3-way message;
the builtin `rdf` output plugin still resolves via the local-dir fallback; full
suite green.

Worsened by the first-pass #17 fix (which added the bare-import fallback): a
syntax/runtime error in an *existing* plugin file falls through all three
attempts and reports `Cannot load plugin: … Tried direct path, local
transform directory, and bare package import.` with the real `SyntaxError`
buried in `cause[0]` (not rendered at default log level). **Reproduced.**

**Fix:** rethrow `e1` immediately when `e1.code !== 'ERR_MODULE_NOT_FOUND'`
(the file was found; retrying it as an npm package is wrong), and likewise
for the later attempts.

Severity: medium. Confidence: certain (reproduced).

## Low

- **`src/transform/marcinrdf.ts:34`** — a record without a 001 mints
  `"@id": "http://example.org/record/undefined"` (verified); in
  `parse=quads` mode that becomes a real bogus IRI and all id-less records
  collide on the same subject. Same class as the fixed marc2rdf #12; the
  guard is a one-liner. ✅ FIXED — a missing/empty 001 now falls back to a
  unique `http://example.org/record/genid-<uuid>` IRI, so id-less records stay
  distinct and the IRI is valid in the JSON-LD, quads, and text serializers.
  Verified: a record with no 001 emits a `genid-…` subject, not `/undefined`.
- **`src/command.ts:27-28` + `src/attacker.ts:123`** — `--count 0` and
  `--count abc` silently disable the limiter (`parseInt` → 0/NaN, then the
  `if (opts.count || opts.skip)` gate is falsy → **all** records emitted
  instead of 0/an error). The parseInt added by #14 has no validation.
  ✅ FIXED — `command.ts` now rejects a non-integer/negative `--count`/`--skip`
  with EX_USAGE (64), and `createCountSkipStage` gates on `!== undefined`
  (not truthiness) so `--count 0` builds the limiter and emits zero records.
  Verified: `--count 0` → 0 records, exit 0; `--count abc` / `--skip -2` → 64;
  `--count 5` → 5.
- **`src/attacker.ts:246-249`** — `file:` *output* URLs use undecoded
  `url.pathname`, so `--out 'file:///tmp/a%20b.json'` creates a file
  literally named `a%20b.json`. Input side was fixed; this branch was missed.
  Use `fileURLToPath(url)`. ✅ FIXED — the branch now passes the `URL` object
  straight to `fs.createWriteStream(url, …)`, which percent-decodes it (and
  handles Windows `/C:/` paths), mirroring the read side. Verified:
  `--out 'file:///tmp/a%20b.json'` now creates `a b.json`.
- **`src/globber.ts:156-160`** — the crash cause is logged at debug level
  (`logger.debug(e)`), so after the #18 level fix users see "process crashed"
  with no detail. Should be `logger.error(e)` like command.ts. ✅ FIXED — the
  cause is now logged with `logger.error(e)`.
- **`src/attacker.ts:353-359`** — dead catch: both branches rethrow
  identically (`if (e instanceof PipelineError) { throw e; } else { throw e; }`).
  ✅ FIXED as part of #6 — the catch now destroys all built stages before
  rethrowing the original error.
- **`src/output/json.ts:34-39`** — empty input produces a zero-byte file
  instead of `[]` (flush only pushes `"]"` when `!isFirst`) — invalid JSON
  for any consumer that parses it. ✅ FIXED — flush now pushes `"[]"` when no
  record was written (`isFirst`), `"]"` otherwise. Verified: empty input →
  `[]`; regression test added.
- **`src/stream/worker-pool.ts:157`** — `outQueue.push(...m)` spreads every
  fanned-out row as an argument; ≳100k rows from one record throws
  `RangeError: Maximum call stack size exceeded`. Use a loop. ✅ FIXED — the
  fan-out batch is now appended with `for (const row of m) outQueue.push(row)`.
- **`src/marcmap.ts:68-69`** — `subMatch` is built with broken alternation
  precedence: `find.substring(3).split("").join("|")` yields `^a|b$`, which
  parses as `(^a)|(b$)`; a path like `245$a` yields `^$|a$` (matches empty
  codes). Harmless for well-formed single-char codes, wrong otherwise.
  ✅ FIXED — the alternation is now grouped: `^(?:a|b)$`. Regression test added
  (a code `ax`/`xb` no longer partial-matches the path `200ab`).
- **`src/command.ts:120-129`** — `restoreTerminalAndDie` exits via SIGKILL
  (status 137), so `set -o pipefail` scripts see a benign
  `marcattacks … | head` as a failure. Deliberate for the tty fix, but the
  exit-status side effect is undocumented. ✅ FIXED — `restoreTerminalAndDie`
  now probes the controlling tty (`stty -a`): only a pager that left it in raw
  mode (`-icanon`) takes the `stty sane` + SIGKILL path; a `| head`, a
  pipe/file sink, or a run with no controlling tty is a benign disconnect and
  exits `0`, so pipefail scripts stay green. Part of a broader move to semantic
  sysexits-style exit codes (see below).

### Semantic exit codes (sysexits.h) — ✅ ADDED

The ad-hoc exit statuses (1/2/3/4/8/137) were replaced with a curated
sysexits-style scheme in `src/exit-codes.ts` (`ExitCode` + `classifyError`),
wired through `command.ts`, `attacker.ts`, `globber.ts`, `plugin-loader.ts` and
`httpstream.ts`: 64 usage, 65 data-format, 66 no-input, 70 internal, 73
can't-create, 74 I/O, 76 protocol, 77 permission, 78 config; benign stops
(reader-disconnect, `--count` limit) exit 0. Throw sites that know their
category tag the error with an explicit `exitCode` (e.g. a broken plugin → 70,
an unknown plugin name → 64, an HTTP status → 76); everything else is inferred
from the Node error `code`/message. This subsumes several findings whose root
cause was an opaque or wrong exit status. Documented in README ("Exit codes");
verified end-to-end (missing file → 66, unknown plugin → 64, binary→jsonl → 65,
HTTP 404 → 76, `| head` under pipefail → 0); full suite green (156/156).
- **`src/stream/slow-writable.ts`** — the `queue`/`maxConcurrency` machinery
  is dead code: `Writable` serializes `_write` calls (the next `_write` only
  arrives after the previous callback), so the queue never holds more than
  one item and concurrency can never exceed 1. Pre-existing, harmless.
  ⬜ NOT FIXED (deliberate) — this is a test/benchmark sink (`--out` simulator);
  the `_destroy` teardown errors pending `queue`/`active` callbacks, so removing
  the machinery is a non-trivial rewrite of working code for zero behavior
  change. Left as-is.
- **`src/output/multipart.ts:25-31`** — the first part is never preceded by a
  boundary delimiter, so a strict MIME parser treats it as preamble. Possibly
  intentional for this homegrown format. ✅ FIXED — the first part is now
  preceded by a boundary delimiter by default (valid MIME). A new
  `noStartDelimiter='true'` option (symmetric to `noEndDelimiter`) restores the
  pure between-records separator for the homegrown `@message.` message-stream
  format; the `demo:rdf:messages` and `demo:biblio` scripts set it to preserve
  their output.
- **`src/stream/httpstream.ts`** (`httpLatestObject`/`httpGlobFiles`) — on a
  parser error the rejected promise leaves the response stream undestroyed,
  pinning a keep-alive socket until timeout. ✅ FIXED — both functions now
  reject through a `fail()` helper that `stream.destroy()`s the response first,
  releasing the socket immediately (the success path still fully consumes the
  stream, returning the socket to the pool).

## Additional findings (surfaced while fixing the above)

### 21. `src/transform/jsonata.ts` — `--param fix=$` errors instead of being the identity pass-through — ✅ FIXED

Surfaced during #5 testing. `createMapper` treats `opts.fix` strictly as a file
path, so `--param fix=$` does `fs.existsSync("$")` → false → throws
`no such file $`; the identity short-circuit (`query.trim() === '$'`) only ran
for the *no-fix* default, never for an explicit `$`.

**Fix:** an explicit `$` (trimmed) is now recognised as the identity in both
`createMapper` (skips the file read, returns the pass-through mapper) and
`isPassthrough` (so the map stage is skipped entirely). A genuine typo'd file
path still throws "no such file". Verified: `--param fix=$` passes all 1000
sample records through unchanged — serial, with `--workers 4`, and with
`--count 5` (→ 5) — while `--param fix=/no/such.jsonata` still errors.

## Verified clean (regression checks on the a50e5cc fixes)

- **sftpstream** — the post-handoff error forwarding is sound: ssh2's
  read/write streams are real core-stream subclasses with `_destroy`, the
  `Readable | undefined` narrowing compiles, and the pre-attached `'error'`
  listener prevents an unhandled event even if the conn errors immediately.
- **rdf_parse `parseStreamAsParts`** — mid-stream parser errors reach the
  consumer after earlier quads (verified), no hang; the
  `on('error') → output.destroy(error)` handler covers pipe()'s
  no-error-forwarding gap.
- **marcinrdf shallow copy** — nothing mutates the shared rows
  (`serializeFieldRecord` uses `slice`); `JSON.stringify` ignores the copied
  `CLEAN` symbol, so the quads path is unaffected.
- **s3stream invariants** — parts ordering is guaranteed (Writable serializes
  `_write`); the empty-object `PutObject` path is safe without the
  `completed` flag (`uploadId` is null so abort short-circuits).
- **slow-writable rewrite** — the error path emits `'error'` exactly once;
  `_final` handles a mid-finalize destroy.
- **Fixed readers** (jsonl/tsv/marc/json/xml/fastxml StringDecoder + flush
  changes) — all hold up; a parser error during marc/json flush is covered by
  `transformer.destroy(err)`.
- **httpstream** — agents are module-level (no per-hop leak); `res.resume()`
  precedes both the cap rejection and the recursion; cross-protocol redirects
  pick the correct client/agent.
- Otherwise clean: `worker.ts`, the csv reader/writer, `parquet.ts`,
  `fix.ts`/`jsonata.ts`, `avram.ts`, `marcids.ts`, `xml_escape.ts`,
  `jsonld.ts`, `marc_n3_helpers.ts`, `tsv_parse.ts`, `stream_helpers.ts`.

## Suggested order of attack

1. **#1** marc.ts control fields — one-line fix for silent data corruption on
   every ISO2709 conversion.
2. **#2** worker-pool `destroy()` — without it both halves of the original
   #19 remain effectively open; unblocks **#6** too.
3. **#3** s3stream abort race — flag-based guard, closes the orphan-upload
   hole the abort fix was meant to seal.
4. **#4** httpstream invalid Location — small try/catch, removes a remote
   crash trigger.
5. The z00r test fix (restore `createMapper`/`fanOut` without
   `autoParallel`) — turns the suite fully green and restores fan-out
   coverage.
6. Then the remaining medium tier (#5–#10) and the low tier.
