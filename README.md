# alma2else

Turn Clarivate Alma XML exports into something else.

## Build

```
npm install
```

```
npm run build:ts
```

```
npm link
```

### Run

Generate JSON:

```
alma2else --to json <file>
```

Generate Aleph sequential:

```
alma2else --to alephseq <file>
```

Generate RDF:

```
alma2else --to rdf --map rdf <file>
```

Generate XML:

```
alma2else --to xml <file>
```

## Remote files

A remote SFTP path:

```
alma2else --key ~/.ssh/privatekey sftp://username@hostname:port/remote/path
```

The latest XML file in a remote SFTP:

```
alma2else --key ~/.ssh/privatekey sftp://username@hostname:port/remote/path/@latest:xml
```

A remote HTTP path

```
alma2else --from jsonl http://somewhere.org/data.jsonl
```

## Formats

### Input (--from)

- xml
- alephseq (Aleph sequential)
- json
- jsonl

### Output (--to)

- xml
- alephseq (Aleph sequential)
- json
- jsonl
- rdf

### Transform (--map)

- rdf

Provide your own transformers using JavaScript plugins. See: ./plugin/demo.js for an example.