module loan-orchestrator

go 1.23.0

toolchain go1.23.12

require (
	github.com/farmconnect/shared v0.0.0
	github.com/go-chi/chi/v5 v5.3.0
)

require (
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/golang-jwt/jwt/v5 v5.3.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/klauspost/compress v1.17.4 // indirect
	github.com/pierrec/lz4/v4 v4.1.19 // indirect
	github.com/redis/go-redis/v9 v9.12.1 // indirect
	github.com/segmentio/kafka-go v0.4.47 // indirect
)

replace github.com/farmconnect/shared => ../shared
