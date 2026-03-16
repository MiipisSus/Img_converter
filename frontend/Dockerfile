# ── Stage 1: Build ──
FROM node:20-alpine AS build

ARG APP_VERSION=dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG APP_VERSION=dev-build
RUN VITE_APP_VERSION=$APP_VERSION npm run build

# ── Stage 2: Serve ──
FROM nginx:alpine

# 移除預設設定
RUN rm /etc/nginx/conf.d/default.conf

# 複製自訂 Nginx 設定
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 複製編譯後的靜態檔
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
