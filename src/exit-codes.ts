// Semantic process exit codes, following the BSD sysexits.h conventions so
// that callers (and `set -o pipefail` scripts) can tell *why* a run failed.
//
// A curated subset: only the categories marcattacks can actually produce.
// Benign stops (the downstream reader closing the pipe, or `--count` reaching
// its limit) exit 0 — they are a successful, expected end of work.
export const ExitCode = {
    OK:        0,    // success, or a benign reader-disconnect / --count stop
    USAGE:     64,   // EX_USAGE     — bad CLI args (missing file, --from, unknown plugin name)
    DATAERR:   65,   // EX_DATAERR   — input could not be parsed (bad XML/JSON/MARC record)
    NOINPUT:   66,   // EX_NOINPUT   — input file/object/"@latest" not found (ENOENT)
    SOFTWARE:  70,   // EX_SOFTWARE  — internal error (worker crash, broken plugin file)
    CANTCREAT: 73,   // EX_CANTCREAT — output could not be created (--out / S3 PutObject)
    IOERR:     74,   // EX_IOERR     — read/write/connection failure mid-stream (ECONNRESET, premature close)
    PROTOCOL:  76,   // EX_PROTOCOL  — remote protocol error (HTTP 4xx/5xx, too many redirects)
    NOPERM:    77,   // EX_NOPERM    — permission denied (EACCES/EPERM)
    CONFIG:    78,   // EX_CONFIG    — configuration / credential error
} as const;

export type ExitCodeValue = typeof ExitCode[keyof typeof ExitCode];

// Map an arbitrary thrown error to a semantic exit code. A throw site that
// knows its own category can attach an explicit numeric `exitCode` to the
// error (or any of its `cause`s) and it always wins; otherwise we infer from
// the Node error `code` and, as a last resort, the message. Anything we cannot
// place is an internal/software error.
export function classifyError(err: any): ExitCodeValue {
    // 1. An explicit exitCode tagged at the throw site wins, at any cause depth.
    for (let e: any = err; e; e = e.cause) {
        if (typeof e?.exitCode === 'number') return e.exitCode as ExitCodeValue;
    }

    // 2. Infer from the standard Node error code / message, nearest cause first.
    for (let e: any = err; e; e = e.cause) {
        switch (e?.code) {
            case 'ENOENT':
                return ExitCode.NOINPUT;
            case 'EACCES':
            case 'EPERM':
                return ExitCode.NOPERM;
            case 'ECONNRESET':
            case 'ECONNREFUSED':
            case 'ETIMEDOUT':
            case 'ENOTFOUND':
            case 'EHOSTUNREACH':
            case 'ENETUNREACH':
            case 'EPIPE':
            case 'ERR_STREAM_PREMATURE_CLOSE':
            case 'ERR_STREAM_DESTROYED':
                return ExitCode.IOERR;
        }

        const msg = typeof e?.message === 'string' ? e.message : '';
        if (/^HTTP \d{3}\b/.test(msg) || /too many redirects/i.test(msg)) {
            return ExitCode.PROTOCOL;
        }
        // A SyntaxError reaching here is a JSON/data parse failure (a broken
        // *plugin* file is tagged SOFTWARE explicitly, so it never lands here).
        if (e instanceof SyntaxError ||
            /\bnot .*\bxml\b/i.test(msg) ||
            /Unexpected (token|end)/i.test(msg)) {
            return ExitCode.DATAERR;
        }
    }

    return ExitCode.SOFTWARE;
}
