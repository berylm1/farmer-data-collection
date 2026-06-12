FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum* ./
RUN go mod tidy && go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /mobile-money-service main.go

FROM alpine:3.19

WORKDIR /app

RUN apk --no-cache add ca-certificates curl

COPY --from=builder /mobile-money-service /app/mobile-money-service

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:8090/health || exit 1

CMD ["/app/mobile-money-service"]
