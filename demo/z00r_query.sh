#!/bin/bash

duckdb -csv <<EOF
-- Some macros to make querying subfields easier
CREATE MACRO sf(subfields, c) AS
  list_transform(list_filter(subfields, lambda x : x.code = c), lambda x : x.value);

CREATE MACRO has_sf(subfields, c, pat) AS
  len(list_filter(subfields, lambda x : x.code = c AND x.value ILIKE pat)) > 0;

CREATE MACRO sf_notnull(subfields, c) AS
  coalesce(len(list_filter(subfields, lambda x : x.code = c AND x.value IS NOT NULL)) > 0, false);

-- The real query:
--   Give me the record ids and 245b of the records with 245a has Gent and have a 245b
SELECT record_id, sf(subfields, 'b')[1] AS sub_b
FROM './local/z00r.parquet'
WHERE tag = '245' AND has_sf(subfields, 'a', '%Gent%') and sf_notnull(subfields,'b');
EOF