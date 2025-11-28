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

Generate JSON

```
alma2else --to json <file>
```

Generate Aleph sequential

```
alma2else --to alephseq <file>
```

Generate Prolog

```
alma2else --to prolog <file>
```

Generate RDF

```
alma2else --to rdf <file>
```

Generate XML

```
alma2else --to xml <file>
```

## Remote files

A remote SFTP path

```
alma2else --host hostname --port port --username username --key ~/.ssh/privatekey /remote/path
```

The latest XML file in a remote SFTP path

```
alma2else --host hostname --port port --username username --key ~/.ssh/privatekey /remote/path/@latest:xml
```


