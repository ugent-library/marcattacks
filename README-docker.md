# Docker

## Build marcattacks

Build a version of a docker image:

```
docker build . -t hochstenbach/marcattacks:v0.0.1
```

Run a docker image:

```
docker run --rm -v `pwd`/data:/app/data -it hochstenbach/marcattacks:v0.0.1 --rdf data/sample.xml
```

Push it to DockerHub:

```
docker push hochstenbach/marcattacks:v0.0.1
```

### S3 development

Start S3 service:

```
docker compose up -d
```

Stop everything:

```
docker compose down
```

Connect to the admin interface: http://localhost:3372/login

Username/password: minioadmin/minioadmin
