# Docker

## Build marcattacks

Build a version of a docker image:

```
docker build . -t hochstenbach/marcattacks:v0.0.1
```

Run a docker image:

```
docker run --rm -v `pwd`/data:/app/data -it hochstenbach/marcattacks:v0.0.1 --to rdf --map marc2rdf data/sample.xml
```

Push it to DockerHub:

```
docker push hochstenbach/marcattacks:v0.0.1
```

## Local development services

`docker-compose.yaml` provides S3 (MinIO), SFTP and HTTP services for testing
the `s3://`, `s3s://`, `sftp://` and `http://` input/output backends locally.

Start everything:

```
docker compose up -d
```

Stop everything (and discard the test data volumes):

```
docker compose down -v
```

### S3 (MinIO)

MinIO listens on port `3371` (API) and `3372` (console), and the `mc` init
container creates a bucket `bbl`.

- Admin console: http://localhost:3372/login
- Username/password: `minioadmin`/`minioadmin`

Credentials are read from the URL, or from the `S3_ACCESS_KEY` / `S3_SECRET_KEY`
environment variables (note: credentials in the URL take precedence; the env
vars are only used as a fallback when the URL omits them).

```
# write a local file to S3 as JSONL
marcattacks data/sample.xml --from xml --to jsonl \
  --out s3://minioadmin:minioadmin@localhost:3371/bbl/sample.jsonl

# read it back
marcattacks s3://minioadmin:minioadmin@localhost:3371/bbl/sample.jsonl --from jsonl

# resolve the newest .jsonl in the bucket
marcattacks 's3://minioadmin:minioadmin@localhost:3371/bbl/@latest:jsonl' --from jsonl

# list matching objects
globtrotr 's3://minioadmin:minioadmin@localhost:3371/bbl/@glob:jsonl'
```

### SFTP

An `atmoz/sftp` server listens on port `2222` as user `marc` (password
`marcpass`). The repo's `data/` directory is mounted **read-only** at `/files`,
and a writable volume is mounted at `/upload` for write-back tests.

Credentials are read from the URL, or from the `SFTP_USERNAME` /
`SFTP_PASSWORD` environment variables (credentials in the URL take precedence;
the env vars are only a fallback when the URL omits them); private-key auth is
available via `--key <file>` or `--keyEnv <ENVVAR>`.

```
# read a seeded file
marcattacks --from xml sftp://marc:marcpass@localhost:2222/files/sample.xml --to json

# resolve the newest .gz under /files
marcattacks --from xml 'sftp://marc:marcpass@localhost:2222/files/@latest:gz'

# list matching files
globtrotr 'sftp://marc:marcpass@localhost:2222/files/@glob:xml'

# write-back (the /upload dir is writable)
marcattacks data/sample.xml --from xml --to jsonl \
  --out sftp://marc:marcpass@localhost:2222/upload/out.jsonl
```

### HTTP

An `nginx` server on port `8080` serves the repo's `data/` directory as static
files. HTTP is **read-only** (there is no HTTP write backend).

For `@latest:` / `@glob:`, marcattacks does not parse a directory listing — it
GETs the container URL and parses the response as RDF, reading `ldp:contains`
members and `dcterms:modified`. The server therefore returns an LDP container
document (`docker/http/container.ttl`) at `/`; edit it to add or re-date members.

```
# read a static file
marcattacks --from xml http://localhost:8080/sample.xml --to json

# resolve the newest member with a given extension
marcattacks --from xml 'http://localhost:8080/@latest:xml'

# list container members
globtrotr 'http://localhost:8080/@glob:xml'
globtrotr 'http://localhost:8080/@glob:*'
```

## Testing the backends

A quick smoke test that exercises read, `@latest:`, glob and (where supported)
write-back across all three backends. It uses the sample data in `data/`;
`data/sample.xml` holds 1000 records, so each read should report `1000`.

Build first (`npm run build`), then bring the services up and wait until they
are ready:

```sh
docker compose up -d
# give MinIO / sshd / nginx a few seconds to accept connections
sleep 5
```

```sh
S3=s3://minioadmin:minioadmin@localhost:3371/bbl
SFTP=sftp://marc:marcpass@localhost:2222
HTTP=http://localhost:8080

# --- S3 round-trip (read + write) ---
node dist/command.js data/sample.xml --from xml --to jsonl --out "$S3/sample.jsonl"
node dist/command.js "$S3/sample.jsonl" --from jsonl --to jsonl | wc -l         # -> 1000
node dist/command.js "$S3/@latest:jsonl" --from jsonl --to jsonl | wc -l        # -> 1000
node dist/globber.js  "$S3/@glob:jsonl"

# --- SFTP round-trip (read from /files, write to /upload) ---
node dist/command.js "$SFTP/files/sample.xml" --from xml --to jsonl | wc -l     # -> 1000
node dist/command.js "$SFTP/files/@latest:gz" --from xml --to jsonl | wc -l     # -> 1000
node dist/command.js data/sample.xml --from xml --to jsonl --out "$SFTP/upload/out.jsonl"
node dist/command.js "$SFTP/upload/out.jsonl" --from jsonl --to jsonl | wc -l   # -> 1000
node dist/globber.js  "$SFTP/files/@glob:xml"

# --- HTTP (read-only) ---
node dist/command.js "$HTTP/sample.xml" --from xml --to jsonl | wc -l           # -> 1000
node dist/command.js "$HTTP/@latest:xml" --from xml --to jsonl | wc -l          # -> 1000
node dist/globber.js  "$HTTP/@glob:*"
```

Tear down and discard the test volumes when done:

```sh
docker compose down -v
```

Notes:

- The `marcattacks` / `globtrotr` examples above use `node dist/command.js` /
  `node dist/globber.js`; substitute the installed `marcattacks` / `globtrotr`
  binaries if you have them on your `PATH`.
- HTTP has no write backend, so there is no HTTP write-back step.
- The tests never modify `data/`: it is mounted **read-only** as the SFTP
  `/files` and HTTP roots, and the S3 examples read the local file directly and
  write to MinIO. SFTP writes land in a named volume (`/upload`).
