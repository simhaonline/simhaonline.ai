FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
# stdlib only — no go.sum needed, no network fetch
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/router-opt .
FROM alpine:3.20
RUN adduser -D -u 10101 app && apk add --no-cache ca-certificates
USER app
COPY --from=build /out/router-opt /usr/local/bin/router-opt
EXPOSE 8113
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8113/healthz || exit 1
ENTRYPOINT ["router-opt"]