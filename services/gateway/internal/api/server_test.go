package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestIDAddsSecurityHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	res := httptest.NewRecorder()
	requestID(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })).ServeHTTP(res, req)
	for _, header := range []string{"X-Request-ID", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Content-Security-Policy"} {
		if res.Header().Get(header) == "" {
			t.Fatalf("missing %s", header)
		}
	}
}
