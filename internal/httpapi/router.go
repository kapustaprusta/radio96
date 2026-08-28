package httpapi

import (
	"encoding/json"
	"net/http"
)

type statusResponse struct {
	Status string `json:"status"`
}

func NewHandler() http.Handler {
	router := http.NewServeMux()
	router.HandleFunc("GET /healthz", statusHandler)
	router.HandleFunc("GET /readyz", statusHandler)

	return router
}

func statusHandler(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)

	_ = json.NewEncoder(response).Encode(statusResponse{Status: "ok"})
}
