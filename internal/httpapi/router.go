package httpapi

import (
	"context"
	"net/http"
	"path"

	"github.com/kapustaprusta/radio96/internal/room"
)

type CreateRoomUseCase interface {
	Execute(ctx context.Context) (*room.Room, error)
}

type GetRoomUseCase interface {
	Execute(ctx context.Context, inviteCode string) (*room.Room, error)
}

type JoinRoomUseCase interface {
	Execute(ctx context.Context, inviteCode, displayName string) (*room.JoinRoomResult, error)
}

type Dependencies struct {
	CreateRoom CreateRoomUseCase
	GetRoom    GetRoomUseCase
	JoinRoom   JoinRoomUseCase
	Ready      func(context.Context) error
}

type handler struct {
	dependencies Dependencies
}

type statusResponse struct {
	Status string `json:"status"`
}

func NewHandler(dependencies *Dependencies) http.Handler {
	api := &handler{}
	if dependencies != nil {
		api.dependencies = *dependencies
	}

	router := http.NewServeMux()
	router.HandleFunc("GET /healthz", statusHandler)
	router.HandleFunc("/healthz", methodNotAllowed(http.MethodGet+", "+http.MethodHead))
	router.HandleFunc("GET /readyz", api.readiness)
	router.HandleFunc("/readyz", methodNotAllowed(http.MethodGet+", "+http.MethodHead))
	router.HandleFunc("POST /api/v1/rooms", api.createRoom)
	router.HandleFunc("/api/v1/rooms", methodNotAllowed(http.MethodPost))
	router.HandleFunc("GET /api/v1/rooms/{inviteCode}", api.getRoom)
	router.HandleFunc("/api/v1/rooms/{inviteCode}", methodNotAllowed(http.MethodGet+", "+http.MethodHead))
	router.HandleFunc("POST /api/v1/rooms/{inviteCode}/join", api.joinRoom)
	router.HandleFunc("/api/v1/rooms/{inviteCode}/join", methodNotAllowed(http.MethodPost))
	router.HandleFunc("/", notFound)

	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Referrer-Policy", "no-referrer")

		// ServeMux redirects noncanonical paths, which would echo secret invite codes.
		if path.Clean(request.URL.Path) != request.URL.Path {
			notFound(response, request)
			return
		}

		router.ServeHTTP(response, request)
	})
}

func statusHandler(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, statusResponse{Status: "ok"})
}

func (api *handler) readiness(response http.ResponseWriter, request *http.Request) {
	if api.dependencies.Ready == nil || api.dependencies.Ready(request.Context()) != nil {
		writeAPIError(response, http.StatusServiceUnavailable, "not_ready", "Service is not ready.")
		return
	}

	statusHandler(response, request)
}

func methodNotAllowed(allow string) http.HandlerFunc {
	return func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Allow", allow)
		writeAPIError(response, http.StatusMethodNotAllowed, "method_not_allowed", "This method is not allowed.")
	}
}

func notFound(response http.ResponseWriter, _ *http.Request) {
	writeAPIError(response, http.StatusNotFound, "not_found", "The requested resource was not found.")
}
