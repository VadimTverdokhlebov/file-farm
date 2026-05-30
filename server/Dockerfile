FROM node:20-alpine AS build

WORKDIR /src

COPY protos ./protos

COPY server/package*.json ./

RUN npm ci --only=production=false

COPY server/ .

RUN npm run build

FROM node:20-alpine AS production

WORKDIR /src

COPY protos ./protos

COPY server/package*.json ./

RUN npm ci --only=production && npm cache clean --force

COPY --from=build /src/build ./build
COPY --from=build /src/protos ./protos

RUN mkdir -p logs

EXPOSE 50051 9092

CMD ["npm", "start"]