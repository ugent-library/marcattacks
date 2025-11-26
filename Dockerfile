FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

FROM node:20-alpine3.20

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./

COPY --from=0 /app/node_modules /app/node_modules

COPY . .

ENTRYPOINT [ "node","dist/index.js" ]

CMD [ "--help"]