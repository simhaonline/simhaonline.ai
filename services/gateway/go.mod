module github.com/simhaonline/gateway

go 1.23.0

toolchain go1.23.12

require (
	github.com/jackc/pgx/v5 v5.7.4
	github.com/valkey-io/valkey-go v1.0.63
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/crypto v0.36.0 // indirect
	golang.org/x/sync v0.12.0 // indirect
	golang.org/x/sys v0.31.0 // indirect
	golang.org/x/text v0.23.0 // indirect
)

// valkey-go pulls miniredis for tests only; keep the module graph small
// (pgx pulls the rest).
