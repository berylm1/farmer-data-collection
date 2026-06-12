FROM golang:1.23-alpine AS builder
WORKDIR /app

COPY shared ./shared
COPY loan-orchestrator/go.mod loan-orchestrator/go.sum* ./loan-orchestrator/

WORKDIR /app/loan-orchestrator
RUN go mod download

COPY loan-orchestrator/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o /service .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates curl
COPY --from=builder /service /service
EXPOSE 8080
CMD ["/service"]
