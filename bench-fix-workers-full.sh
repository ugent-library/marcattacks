#!/usr/bin/env bash
# Benchmark the compiled `fix` mapper across worker counts on the FULL dump.
# Mapping-engine focus: fastxml -> marc2rdf.fix -> null sink.
set -u
GZ=/tmp/ugent-backup1_20260531.xml.gz
FIX=./demo/marc2rdf.fix
RESULTS=/tmp/bench-fix-workers-full.txt
: > "$RESULTS"

printf "%-9s | %-12s | %-9s | %-10s | %-10s | %s\n" \
  "workers" "threads" "total" "rate(r/s)" "wall(s)" "peakRSS(MB)" | tee -a "$RESULTS"
printf -- "----------+--------------+-----------+------------+------------+------------\n" | tee -a "$RESULTS"

for W in 1 2 4 7; do
  start=$(date +%s.%N)
  out=$(npx marcattacks --to null --map fix --param fix="$FIX" --from fastxml --z \
        --workers "$W" --info "$GZ" --out /dev/null 2>&1)
  end=$(date +%s.%N)
  wall=$(awk "BEGIN{printf \"%.1f\", $end-$start}")
  total=$(echo "$out"  | grep -oE "total: [0-9]+"                       | grep -oE "[0-9]+" | tail -1)
  rate=$(echo "$out"   | grep -oE "\([0-9]+ recs/sec\)"                 | grep -oE "[0-9]+" | tail -1)
  rss=$(echo "$out"    | grep -oE "peak RSS: [0-9.]+"                   | grep -oE "[0-9.]+" | tail -1)
  thr=$(echo "$out"    | grep -oE "map running on [0-9]+ worker threads"| grep -oE "[0-9]+" | head -1)
  printf "%-9s | %-12s | %-9s | %-10s | %-10s | %s\n" \
    "$W" "${thr:-1 (serial)}" "${total:-ERR}" "${rate:-?}" "$wall" "${rss:-?}" | tee -a "$RESULTS"
done
echo "DONE" | tee -a "$RESULTS"
