package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStatusEndpoints(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name            string
		method          string
		path            string
		wantStatus      int
		wantContentType string
		wantBody        string
	}{
		{
			name:            "health",
			method:          http.MethodGet,
			path:            "/healthz",
			wantStatus:      http.StatusOK,
			wantContentType: "application/json",
			wantBody:        "{\"status\":\"ok\"}\n",
		},
		{
			name:            "readiness",
			method:          http.MethodGet,
			path:            "/readyz",
			wantStatus:      http.StatusOK,
			wantContentType: "application/json",
			wantBody:        "{\"status\":\"ok\"}\n",
		},
		{
			name:       "unsupported method",
			method:     http.MethodPost,
			path:       "/healthz",
			wantStatus: http.StatusMethodNotAllowed,
		},
	}

	handler := NewHandler()

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequestWithContext(t.Context(), testCase.method, testCase.path, nil)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != testCase.wantStatus {
				t.Errorf("status = %d, want %d", response.Code, testCase.wantStatus)
			}

			if testCase.wantContentType != "" {
				contentType := response.Header().Get("Content-Type")
				if contentType != testCase.wantContentType {
					t.Errorf("Content-Type = %q, want %q", contentType, testCase.wantContentType)
				}
			}

			if testCase.wantBody != "" && response.Body.String() != testCase.wantBody {
				t.Errorf("body = %q, want %q", response.Body.String(), testCase.wantBody)
			}
		})
	}
}
