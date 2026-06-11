import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../dist/command.js");

let dir: string;
let input: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-cli-"));
    input = path.join(dir, "records.json");
    fs.writeFileSync(input, JSON.stringify([
        { record: [["001", " ", " ", "_", "111"]] },
        { record: [["001", " ", " ", "_", "222"]] },
    ]));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

interface CliResult { code: number | null; stdout: string; stderr: string; }

// Run the compiled CLI as a child process and capture its output + exit code.
function runCli(args: string[]): Promise<CliResult> {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [cli, ...args], { cwd: dir });
        let stdout = "", stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

describe("command (CLI)", () => {
    test("--version prints the package version", async () => {
        const { code, stdout } = await runCli(["--version"]);
        expect(code).toBe(0);
        expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    test("missing required <file> argument exits non-zero", async () => {
        const { code, stderr } = await runCli([]);
        expect(code).toBe(1);
        expect(stderr).toMatch(/missing required argument/i);
    });

    test("converts a local file json -> jsonl on stdout", async () => {
        const { code, stdout } = await runCli([input, "--from", "json", "--to", "jsonl"]);
        expect(code).toBe(0);
        const lines = stdout.trim().split("\n").filter(Boolean);
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]).record[0][4]).toBe("111");
    });

    test("-o writes output to a file", async () => {
        const out = path.join(dir, "out.jsonl");
        const { code } = await runCli([input, "--from", "json", "--to", "jsonl", "-o", out]);
        expect(code).toBe(0);
        const lines = fs.readFileSync(out, "utf-8").trim().split("\n").filter(Boolean);
        expect(lines).toHaveLength(2);
    });

    test("--param key=value pairs are collected and passed to the map", async () => {
        const { code, stdout } = await runCli([
            input, "--from", "json", "--to", "jsonl",
            "--map", "fix", "--param", 'fix=add_field("flag","yes")',
        ]);
        expect(code).toBe(0);
        expect(JSON.parse(stdout.trim().split("\n")[0]!).flag).toBe("yes");
    });

    test("--param value may contain '=' (split on the first '=' only)", async () => {
        const { code, stdout } = await runCli([
            input, "--from", "json", "--to", "jsonl",
            "--map", "fix", "--param", 'fix=add_field("flag","a=b=c")',
        ]);
        expect(code).toBe(0);
        expect(JSON.parse(stdout.trim().split("\n")[0]!).flag).toBe("a=b=c");
    });

    test("--log json runs with the JSON logger configured", async () => {
        const { code, stdout, stderr } = await runCli([
            input, "--from", "json", "--to", "jsonl", "--log", "json", "--info",
        ]);
        expect(code).toBe(0);
        // data still goes to stdout; JSON log lines go to stderr
        expect(stdout.trim().split("\n").filter(Boolean)).toHaveLength(2);
        expect(stderr).toMatch(/\{.*"level".*\}/);
    });

    test("--log stdout runs with the default logger to stdout", async () => {
        const { code } = await runCli([input, "--from", "json", "--to", "jsonl", "--log", "stdout"]);
        expect(code).toBe(0);
    });

    test("an unresolvable input target exits with code 8", async () => {
        const { code } = await runCli(["/no/such/path.json", "--from", "json", "--to", "jsonl"]);
        expect(code).toBe(8);
    });

    // Regression: when the reader on the other end of stdout goes away (a pager
    // quit, `| head`, a dropped socket), the CLI must exit promptly instead of
    // deadlocking while paused on backpressure waiting for a `drain` that never
    // comes. Without the reader-disconnect guard this hangs until the timeout.
    test("exits promptly when the stdout reader disconnects mid-stream", async () => {
        const big = path.join(dir, "big.json");
        fs.writeFileSync(big, JSON.stringify(
            Array.from({ length: 20000 }, (_, i) => ({ record: [["001", " ", " ", "_", String(i)]] })),
        ));

        const exited = await new Promise<boolean>((resolve) => {
            const child = spawn(process.execPath, [cli, big, "--from", "json", "--to", "jsonl"], { cwd: dir });
            const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(false); }, 10000);
            // Read a little, then tear the read end down to simulate the reader leaving.
            child.stdout.once("data", () => child.stdout.destroy());
            child.on("close", () => { clearTimeout(timer); resolve(true); });
        });

        expect(exited).toBe(true);
    });
});
