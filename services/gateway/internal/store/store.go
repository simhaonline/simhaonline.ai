// Package store: PostgreSQL + Valkey data layer for the gateway.
package store

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/valkey-io/valkey-go"
)

// Store bundles the DB pool and Valkey client with domain operations.
type Store struct {
	Pool   *pgxpool.Pool
	Valkey valkey.Client

	// in-memory hot cache of upstream accounts (control-plane data)
	mu         sync.RWMutex
	accounts   map[string]*Account
	policyFile map[string]map[string]any

	// control-plane base URL for the OAuth token broker
	platformAPI string
	// shared upstream HTTP client with connection pooling
	httpClient *http.Client
}

const (
	keyCooldown = "gw:cooldown:"    // + account → unix seconds until available
	keyStrikes  = "gw:strikes:"     // + account → consecutive 429 count
	keyLastUsed = "gw:lastused:"    // + account → unix seconds of last success
	keyWin      = "gw:win:"         // + account:period → sorted-set of request timestamps
	keyModels   = "gw:models:map"   // hash model → comma-separated account names
	keyAllMod   = "gw:models:all"   // set of all known models
	keyLock     = "gw:lock:refresh" // discovery leader lock
)

// Open connects to PostgreSQL and Valkey, verifying both.
func Open(ctx context.Context, dbURL, valkeyURL, platformAPI string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}

	vopts := valkey.MustParseURL(valkeyURL)
	vopts.DisableCache = true
	vc, err := valkey.NewClient(vopts)
	if err != nil {
		pool.Close()
		return nil, err
	}
	if err := vc.Do(ctx, vc.B().Ping().Build()).Error(); err != nil {
		vc.Close()
		pool.Close()
		return nil, err
	}

	transport := &http.Transport{
		MaxIdleConns:        64,
		MaxIdleConnsPerHost: 16,
		IdleConnTimeout:     90 * time.Second,
	}
	return &Store{
		Pool:        pool,
		Valkey:      vc,
		accounts:    map[string]*Account{},
		platformAPI: platformAPI,
		httpClient:  &http.Client{Transport: transport},
	}, nil
}

// Close releases connections.
func (s *Store) Close() {
	s.Valkey.Close()
	s.Pool.Close()
}

// Account mirrors the accounts table row (control-plane data, hot-cached).
type Account struct {
	Name      string
	BaseURL   string
	APIKey    *string
	Provider  string
	Protocol  string
	APIPrefix string
	AuthMode  string
	TokenFile *string
	TokenURL  *string
	ClientID  *string
	ClientSec *string
	Wildcard  bool
	Limits    Limits
}

// Limits holds RPM/RPD/RPW caps (0 = unlimited).
type Limits struct {
	RPM int `json:"rpm"`
	RPD int `json:"rpd"`
	RPW int `json:"rpw"`
}

// Policy is a per-model routing policy (legacy model_policies.json shape).
type Policy struct {
	MaxInputTokens       int  `json:"max_input_tokens"`
	MinOutputTokens      int  `json:"min_output_tokens"`
	MaxOutputTokens      int  `json:"max_output_tokens"`
	MaxToolResultChars   int  `json:"max_tool_result_chars"`
	DedupeSystemMessages bool `json:"dedupe_system_messages"`
}

// DefaultPolicy is the wildcard fallback.
// MinOutputTokens is reserved (not yet enforced by the request path); 0 = none.
func DefaultPolicy() Policy {
	return Policy{
		MaxInputTokens:       128000,
		MinOutputTokens:      0,
		MaxOutputTokens:      16384,
		MaxToolResultChars:   24000,
		DedupeSystemMessages: true,
	}
}

// RecordUsage writes one telemetry row (worker rolls it up later).
func (s *Store) RecordUsage(ctx context.Context, account, model string, status, prompt, completion, total int64, userID, clientKeyID *int64) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO request_history
			(requested_at, account_name, model, status, prompt_tokens, completion_tokens, total_tokens, user_id, client_key_id)
		VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8)`,
		account, model, status, prompt, completion, total, userID, clientKeyID)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO token_usage(account_name, prompt_tokens, completion_tokens, total_tokens)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (account_name) DO UPDATE SET
		prompt_tokens = token_usage.prompt_tokens + EXCLUDED.prompt_tokens,
		completion_tokens = token_usage.completion_tokens + EXCLUDED.completion_tokens,
		total_tokens = token_usage.total_tokens + EXCLUDED.total_tokens`,
		account, prompt, completion, total)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO model_token_usage(model, prompt_tokens, completion_tokens, total_tokens)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (model) DO UPDATE SET
		prompt_tokens = model_token_usage.prompt_tokens + EXCLUDED.prompt_tokens,
		completion_tokens = model_token_usage.completion_tokens + EXCLUDED.completion_tokens,
		total_tokens = model_token_usage.total_tokens + EXCLUDED.total_tokens`,
		model, prompt, completion, total)
	if err != nil {
		return err
	}
	// Keep cost attribution additive and provider-specific. Unknown pricing is
	// recorded as zero until an operator configures model_pricing; it is never
	// guessed from a provider name.
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO usage_cost_events
			(user_id, client_key_id, model, prompt_tokens, completion_tokens, cost_usd)
		SELECT $1, $2, $3, $4, $5,
		       (($4::numeric / 1000000) * COALESCE(MIN(mp.input_cost_per_million), 0)) +
		       (($5::numeric / 1000000) * COALESCE(MIN(mp.output_cost_per_million), 0))
		FROM model_pricing mp
		WHERE mp.model = $3`, userID, clientKeyID, model, prompt, completion)
	return err
}

// TouchClientKey updates last_used_at and request_count for an authed key.
func (s *Store) TouchClientKey(ctx context.Context, keyID int64) error {
	_, err := s.Pool.Exec(ctx,
		`UPDATE client_api_keys SET last_used_at=now(), request_count=request_count+1 WHERE id=$1`, keyID)
	return err
}

// MaintenanceLoop performs periodic housekeeping (session/key cleanup).
func (s *Store) MaintenanceLoop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_, _ = s.Pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < now()`)
			_, _ = s.Pool.Exec(ctx, `DELETE FROM oauth_states WHERE expires_at < now()`)
			_, _ = s.Pool.Exec(ctx, `DELETE FROM oauth_authorization_sessions WHERE expires_at < now()`)
			// Workbench dispatch keys are one-hour ephemeral credentials minted
			// per chat request; without this purge they accumulate forever.
			_, _ = s.Pool.Exec(ctx, `DELETE FROM client_api_keys WHERE expires_at IS NOT NULL AND expires_at < now() - interval '1 day'`)
		}
	}
}
