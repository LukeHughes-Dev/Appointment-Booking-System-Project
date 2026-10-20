# Web image. Build:  docker build -t booking-web web
# Builds the static site, then serves it with nginx. nginx also forwards /api to the API
# container, so the browser sees one origin and no CORS set-up is needed.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Where the browser signs in. This is baked into the site at build time.
ARG VITE_OIDC_AUTHORITY=http://localhost:8080/realms/booking
ENV VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
