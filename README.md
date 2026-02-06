# marcattacks!

<img src="https://codeberg.org/phochste/marcattacks/media/branch/main/logo.jpg" width="10%">

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
marcattacks --to json ./data/sample.xml
```

We can also do this for tar (and) gzipped files

```
marcattacks --to json ./data/sample.tar.gz
```

Generate Aleph sequential:

```
marcattacks --to alephseq ./data/sample.xml
```

Generate RDF:

```
marcattacks --to rdf --map marc2rdf ./data/sample.xml
```

Generate XML:

```
marcattacks --from alephseq --to xml ./data/one.alephseq
```

Transform the MARC input using a [JSONata](https://docs.jsonata.org/overview.html) expression or file:

```
marcattacks --param fix=./demo/demo.jsonata ./data/sample.xml
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
marcattacks s3://accessKey:secretKey@hostname:port/bucket/key
```

use `s3s://...` for using an SSL layer.

## Formats

### Input (--from)

- alephseq (Aleph sequential)
- json
- jsonl
- marc (ISO2709)
- rdf
- tsv
- xml (MARCXML)

### Output (--to)

- alephseq (Aleph sequential)
- json
- jsonl
- parquet
- rdf
- tsv
- xml (MARCXML)

### Transform (--map)

- avram : A mapper from MARC to [Avram](https://format.gbv.de/schema/avram/specification) 
- jsonata : A jsonata fixer (_default_)
- marcids : A mapper from MARC to a list of record ids
- marc2rdf : A mapper from MARC to RDF (demonstrator)

Or, provide your own transformers using JavaScript plugins. See: ./plugin/demo.js for an example.

### Param (--param)

Provide a params to the mapper, input and output. See examples:

- `npm run demo:jsonld`
- `npm run demo:n3`
- `npm run biblio:one`

### Writable (--out)

- _default_: stdout
- _file path_
- sftp://username@host:port/path
- s3://accessKey:secretKey@host:port/bucket/key (or s3s://)
 
### Logging (--info,--debug,--trace,--log)

Logging messages can be provided with the `--info`, `--debug` and `--trace` options.

Default the logging format is a text format that is written to stderr. This logging format and the output stream can be changed with the `--log` option:

- `--log json` : write logs in a JSON format
- `--log stdout` : write logs to the stdout
- `--log json+stdout` : write logs in a JSON format and to the stdout

### Compression (--z,--tar)

Gzip and tar compression of input files can be automatically detected by file name extension. If no such extensions are provided the following flags can be set to force decompression:

- `--z` : the input file is gzipped
- `--tar` : the input file is tarred

### Environment Variables

SFTP and S3 credentials can be set using environment variables or a local `.env` file.
Available variables:

- SFTP_USERNAME
- SFTP_PASSWORD
- S3_ACCESS_KEY
- S3_SECRET_KEY

A SFTP private key can be provided using the `--key-env` command line option. E.g. `--key-env PRIVATE_KEY`, which results reading a `PRIVATE_KEY` environment variable.

## Discover files at a (remote) endpoint

Find all files that end with xml on an sftp site:

```
npx globtrotr --key ~/.ssh/mykey sftp://username@hostname:port/remote/path/@glob:xml
```

Or, for an S3 site:

```
npx globtrotr s3s://accessKey:privateKey@hostname:port/bucket/@glob:xml
```

