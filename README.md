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

Transform the MARC input using a [JSONata](https://docs.jsonata.org/overview.html) expression or file:

```
marcattacks <file> --fix ./demo/demo.jsonata
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

An HTTP path

```
marcattacks http://somewhere.org/data.xml
```

An S3 path

```
marcattacks s3://accessKey:secretKey@host:port/bucket/key
```

use `s3s://...` for using a SSL layer.

## Formats

### Input (--from)

- xml
- alephseq (Aleph sequential)
- json
- jsonl
- rdf

### Output (--to)

- xml
- alephseq (Aleph sequential)
- json
- jsonl
- rdf

### Transform (--map)

- jsonata (_default_: A jsonata fixer)
- marc2rdf (A mapper from MARC to RDF)

Or, provide your own transformers using JavaScript plugins. See: ./plugin/demo.js for an example.

### Fix (--fix)

Provide a (jsonata) fix file to apply to the input data. See: ./demo/demo.jsonata for an example.

### Writable (--out)

- _default_: stdout
- _file path_
- sftp://username@host:port/path
- s3://accessKey:secretKey@host:port/bucket/key (or s3s://)
 