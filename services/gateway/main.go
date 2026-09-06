// Package main: Simha Edge gateway — hot-path multi-provider LLM router (Go).
// Rebuild of simhaedge_proxy.py routing core (FR: routing, cooldowns, budgets,
// discovery, streaming). Control-plane data (accounts, keys, policies) is read
// from PostgreSQL; rolling windows + cooldowns live in Valkey.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/simhaonline/gateway/internal/api"
	"github.com/simhaonline/gateway/internal/store"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	ctx := context.Background()
	dbURL := env("DATABASE_URL", "postgres://simha:simha_dev_password@localhost:5433/simhaonline?sslmode=disable")
	valkeyURL := env("VALKEY_URL", "valkey://localhost:6380/0")

	st, err := store.Open(ctx, dbURL, valkeyURL, env("CONTROL_PLANE_URL", "http://control-plane:8081"))
	if err != nil {
		log.Fatalf("gateway store open: %v", err)
	}
	defer st.Close()

	cfg := api.Config{
		Addr:            env("GATEWAY_ADDR", ":8080"),
		CooldownSeconds: intEnv("COOLDOWN_SECONDS", 60),
		UsageThreshold:  floatEnv("USAGE_THRESHOLD", 0.9),
		RefreshInterval: durationEnv("MODEL_REFRESH_INTERVAL", 300*time.Second),
		PolicyFile:      env("MODEL_POLICY_FILE", "/config/model_policies.json"),
		ProviderCatalog: env("PROVIDER_CATALOG_FILE", "/config/provider_catalog.json"),
		PlatformAPI:     env("CONTROL_PLANE_URL", "http://control-plane:8081"),
		UpstreamTimeout: durationEnv("UPSTREAM_TIMEOUT", 300*time.Second),
		UpstreamDial:    durationEnv("UPSTREAM_DIAL_TIMEOUT", 10*time.Second),
	}

	srv := api.New(st, cfg)

	// initial discovery pass, then periodic refresh (worker also triggers it)
	go func() {
		st.RefreshModels(ctx)
		t := time.NewTicker(cfg.RefreshInterval)
		defer t.Stop()
		for range t.C {
			st.RefreshModels(ctx)
		}
	}()

	// periodic persistence + maintenance (legacy persistence_loop)
	go st.MaintenanceLoop(ctx)

	log.Printf("Simha gateway listening on %s", cfg.Addr)
	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("gateway http: %v", err)
	}
}

func intEnv(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func floatEnv(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}

func durationEnv(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
