# Build stage: compile the Go gateway
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
# Populate the module cache; go.sum will be generated on first build
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/gateway .

# Runtime stage
FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget && adduser -D -u 10001 gateway
USER gateway
COPY --from=build /out/gateway /usr/local/bin/gateway
EXPOSE 8080
ENTRYPOINT ["gateway"]