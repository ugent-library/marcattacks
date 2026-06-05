#!/usr/bin/env bash
# Benchmark MARC XML record processing for marcattacks.
# Runs each pipeline RUNS times, reports min/median/mean wall time,
# throughput (records/sec) and peak RSS (from --info).
set -euo pipefail

CMD="node dist/command.js"
INPUT="data/sample.xml"
RUNS="${RUNS:-5}"
WARMUP="${WARMUP:-1}"

# Number of MARC records in the sample (open tags).
NREC=$(grep -o "<marc:record>" "$INPUT" | wc -l)

echo "marcattacks MARC XML benchmark"
echo "input : $INPUT ($(du -h "$INPUT" | cut -f1), $NREC records)"
echo "node  : $(node --version)"
echo "runs  : $RUNS (after $WARMUP warmup)"
echo

run_bench() {
    local name="$1"; shift
    # args for the CLI are in "$@"
    local warm i start end ms peak total
    for ((warm=0; warm<WARMUP; warm++)); do
        $CMD "$@" "$INPUT" >/dev/null 2>/dev/null || true
    done

    local times=()
    local peak_rss=""
    local total_rec=""
    for ((i=0; i<RUNS; i++)); do
        local errfile; errfile=$(mktemp)
        start=$(date +%s%N)
        $CMD --info "$@" "$INPUT" >/dev/null 2>"$errfile"
        end=$(date +%s%N)
        ms=$(( (end - start) / 1000000 ))
        times+=("$ms")
        peak_rss=$(grep -oE "peak RSS: [0-9.]+ MB" "$errfile" | grep -oE "[0-9.]+" | head -1 || true)
        total_rec=$(grep -oE "total: [0-9]+" "$errfile" | grep -oE "[0-9]+" | head -1 || true)
        rm -f "$errfile"
    done

    # stats
    local sorted; sorted=$(printf '%s\n' "${times[@]}" | sort -n)
    local min med mean sum=0 n=${#times[@]}
    min=$(echo "$sorted" | head -1)
    med=$(echo "$sorted" | awk '{a[NR]=$1} END{print (NR%2)?a[(NR+1)/2]:int((a[NR/2]+a[NR/2+1])/2)}')
    for t in "${times[@]}"; do sum=$((sum+t)); done
    mean=$((sum / n))

    local tput="n/a"
    if [[ -n "$total_rec" && "$med" -gt 0 ]]; then
        tput=$(awk "BEGIN{printf \"%.0f\", $total_rec*1000/$med}")
    fi

    printf "%-28s min %5dms  med %5dms  mean %5dms  | %8s rec/s  | peak %6s MB  (total %s rec)\n" \
        "$name" "$min" "$med" "$mean" "$tput" "${peak_rss:-?}" "${total_rec:-?}"
}

# --- XML parse only (input stage, no downstream transform) ---
run_bench "xml -> json"            --to json
run_bench "xml -> jsonl"           --to jsonl
run_bench "xml -> alephseq"        --to alephseq
run_bench "xml -> xml (roundtrip)" --to xml
run_bench "xml -> rdf (marc2rdf)"  --to rdf --map marc2rdf
