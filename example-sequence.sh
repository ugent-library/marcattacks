#!/bin/bash

# Example how to process files in sequence and concatenate the output
{
    npx marcattacks --from alephseq --to jsonl data/one.alephseq
    npx marcattacks --from xml --to jsonl data/sample.tar
    npx marcattacks --from xml --to jsonl data/sample.tar.gz
    npx marcattacks --from xml --to jsonl data/sample.xml.gz
    npx marcattacks --from xml --to jsonl data/sample.xml
} | npx marcattacks --from jsonl --to xml stdin://