package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStatusEndpoints(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name           string
		path           string
		readyErr       error
		nilReady       bool
		nilDeps        bool
		wantStatus     int
		wantCode       string
		wantReadyCalls int
	}{
		{
			name:       "health",
			path:       "/healthz",
			wantStatus: http.StatusOK,
		},
		{
			name:           "readiness",
			path:           "/readyz",
			wantStatus:     http.StatusOK,
			wantReadyCalls: 1,
		},
		{
			name:           "dependency is unavailable",
			path:           "/readyz",
			readyErr:       errors.New("postgres://private-user:secret@localhost/radio96"),
			wantStatus:     http.StatusServiceUnavailable,
			wantCode:       "not_ready",
			wantReadyCalls: 1,
		},
		{
			name:       "health ignores dependency failure",
			path:       "/healthz",
			readyErr:   errors.New("database is unavailable"),
			wantStatus: http.StatusOK,
		},
		{
			name:       "health without dependencies",
			path:       "/healthz",
			nilDeps:    true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "readiness without dependencies",
			path:       "/readyz",
			nilDeps:    true,
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "not_ready",
		},
		{
			name:       "readiness without a check",
			path:       "/readyz",
			nilReady:   true,
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "not_ready",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, testCase.path, nil)
			response := httptest.NewRecorder()
			readyCalls := 0
			deps := &Dependencies{}
			if !testCase.nilReady {
				deps.Ready = func(ctx context.Context) error {
					readyCalls++
					if ctx != request.Context() {
						t.Error("readiness did not receive the request context")
					}

					return testCase.readyErr
				}
			}

			if testCase.nilDeps {
				deps = nil
			}

			NewHandler(deps).ServeHTTP(response, request)

			if testCase.wantCode != "" {
				assertErrorResponse(t, response, testCase.wantStatus, testCase.wantCode)
			} else {
				assertResponse(t, response, testCase.wantStatus, "", map[string]any{"status": "ok"})
			}

			if readyCalls != testCase.wantReadyCalls {
				t.Errorf("Ready() calls = %d, want %d", readyCalls, testCase.wantReadyCalls)
			}
		})
	}
}

func TestRouteErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantCode   string
		wantAllow  string
	}{
		{
			name: "unknown route", method: http.MethodGet, path: "/unknown",
			wantStatus: http.StatusNotFound, wantCode: "not_found",
		},
		{
			name: "unknown room route", method: http.MethodGet, path: "/api/v1/rooms/" + testInviteCode + "/unknown",
			wantStatus: http.StatusNotFound, wantCode: "not_found",
		},
		{
			name: "create method", method: http.MethodGet, path: "/api/v1/rooms",
			wantStatus: http.StatusMethodNotAllowed, wantCode: "method_not_allowed", wantAllow: http.MethodPost,
		},
		{
			name: "get method", method: http.MethodDelete, path: "/api/v1/rooms/" + testInviteCode,
			wantStatus: http.StatusMethodNotAllowed, wantCode: "method_not_allowed", wantAllow: "GET, HEAD",
		},
		{
			name: "join method", method: http.MethodGet, path: "/api/v1/rooms/" + testInviteCode + "/join",
			wantStatus: http.StatusMethodNotAllowed, wantCode: "method_not_allowed", wantAllow: http.MethodPost,
		},
		{
			name: "health method", method: http.MethodPost, path: "/healthz",
			wantStatus: http.StatusMethodNotAllowed, wantCode: "method_not_allowed", wantAllow: "GET, HEAD",
		},
		{
			name: "readiness method", method: http.MethodPost, path: "/readyz",
			wantStatus: http.StatusMethodNotAllowed, wantCode: "method_not_allowed", wantAllow: "GET, HEAD",
		},
		{
			name: "CORS preflight", method: http.MethodOptions, path: "/api/v1/rooms/" + testInviteCode + "/join",
			wantStatus: http.StatusMethodNotAllowed, wantCode: "method_not_allowed", wantAllow: http.MethodPost,
		},
		{
			name: "trailing slash", method: http.MethodGet, path: "/api/v1/rooms/" + testInviteCode + "/",
			wantStatus: http.StatusNotFound, wantCode: "not_found",
		},
		{
			name: "repeated slash", method: http.MethodGet, path: "/api/v1/rooms//" + testInviteCode,
			wantStatus: http.StatusNotFound, wantCode: "not_found",
		},
		{
			name: "parent segment", method: http.MethodGet, path: "/api/v1/rooms/../" + testInviteCode,
			wantStatus: http.StatusNotFound, wantCode: "not_found",
		},
		{
			name: "dot segment", method: http.MethodGet, path: "/api/v1/rooms/./" + testInviteCode,
			wantStatus: http.StatusNotFound, wantCode: "not_found",
		},
		{
			name: "unimplemented webhook", method: http.MethodPost, path: "/api/v1/livekit/webhook",
			wantStatus: http.StatusNotFound, wantCode: "not_found",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequestWithContext(t.Context(), test.method, test.path, nil)
			request.Header.Set("Origin", "https://example.com")
			response := httptest.NewRecorder()

			NewHandler(nil).ServeHTTP(response, request)

			assertErrorResponse(t, response, test.wantStatus, test.wantCode)
			if got := response.Header().Get("Allow"); got != test.wantAllow {
				t.Errorf("Allow = %q, want %q", got, test.wantAllow)
			}
		})
	}
}
