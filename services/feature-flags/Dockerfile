FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download || (go mod tidy && go mod download)
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/feature-flags .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /app/feature-flags /feature-flags
EXPOSE 8101
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3   CMD wget -q --spider http://localhost:8101/health || exit 1

CMD ["/feature-flags"]
