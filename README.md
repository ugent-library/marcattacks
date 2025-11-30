# marcattack

Turn MARC exports into something else.

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
marcattack --to json <file>
```

Generate Aleph sequential:

```
marcattack --to alephseq <file>
```

Generate RDF:

```
marcattack --to rdf --map rdf <file>
```

Generate XML:

```
marcattack --to xml <file>
```

## Remote files

A remote SFTP path:

```
marcattack --key ~/.ssh/privatekey sftp://username@hostname:port/remote/path
```

The latest XML file in a remote SFTP:

```
marcattack --key ~/.ssh/privatekey sftp://username@hostname:port/remote/path/@latest:xml
```

A remote HTTP path

```
marcattack http://somewhere.org/data.xml
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
