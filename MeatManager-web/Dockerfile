# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN --mount=type=secret,id=web_google_maps_api_key,required=false \
    VITE_GOOGLE_MAPS_API_KEY="$(cat /run/secrets/web_google_maps_api_key 2>/dev/null || true)" npm run build

FROM nginx:1.27-alpine
WORKDIR /srv

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
