# marcattacks!

<img src="logo.jpg" width="10%">

Turn your MARC exports into something else.


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
marcattacks --to json <file>
```

Generate Aleph sequential:

```
marcattacks --to alephseq <file>
```

Generate RDF:

```
marcattacks --to rdf --map rdf <file>
```

Generate XML:

```
marcattacks --to xml <file>
```

## Remote files

A remote SFTP path:

```
marcattacks --key ~/.ssh/privatekey sftp://username@hostname:port/remote/path
```

The latest XML file in a remote SFTP:

```
marcattacks --key ~/.ssh/privatekey sftp://username@hostname:port/remote/path/@latest:xml
```

A remote HTTP path

```
marcattacks http://somewhere.org/data.xml
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

### Writable (--out)

- _default_: stdout
- _file path_
- sftp://username@host:port/path
- s3://accessKey:secretKey@host:port/bucket/key
 
Provide your own transformers using JavaScript plugins. See: ./plugin/demo.js for an example.