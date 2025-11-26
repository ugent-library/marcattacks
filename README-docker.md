# Docker

Build a version of a docker image:

```
docker build . -t hochstenbach/alma2else:v0.0.1
```

Run a docker image:

```
docker run --rm -v `pwd`/data:/app/data -it hochstenbach/alma2else:v0.0.1 --rdf data/sample.xml
```

Push it to DockerHub:

```
docker push hochstenbach/alma2else:v0.0.1
```
