FROM node:20-alpine AS build

WORKDIR /app

COPY client/package*.json ./

RUN npm ci --only=production=false

COPY client/ .

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

ARG VITE_LOAD_STAND_URL=http://localhost:8081
ENV VITE_LOAD_STAND_URL=$VITE_LOAD_STAND_URL

RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

RUN npm install -g serve

COPY --from=build /app/dist ./dist

EXPOSE 5173

CMD ["serve", "-s", "dist", "-l", "tcp://0.0.0.0:5173"]

