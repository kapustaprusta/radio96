package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/kapustaprusta/radio96/internal/room"
)

func TestAdmissionRepository(t *testing.T) {
	testcontainers.SkipIfProviderIsNotHealthy(t)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	t.Cleanup(cancel)
	options := []testcontainers.ContainerCustomizer{
		tcpostgres.WithDatabase(testDatabaseName), tcpostgres.WithUsername(testDatabaseUser),
		tcpostgres.WithPassword(testDatabasePass),
		tcpostgres.WithInitScripts(
			filepath.Join("..", "..", "db", "migrations", "000001_create_rooms.up.sql"),
			filepath.Join("..", "..", "db", "migrations", "000002_room_lifecycle.up.sql"),
		), tcpostgres.BasicWaitStrategies(),
	}
	if os.Getenv("RADIO96_TEST_PODMAN") == "1" {
		options = append(options, testcontainers.WithProvider(testcontainers.ProviderPodman))
	}

	container, err := tcpostgres.Run(ctx, "postgres:17-alpine", options...)
	testcontainers.CleanupContainer(t, container)
	if err != nil {
		t.Fatalf("start PostgreSQL: %v", err)
	}

	connectionString, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("database URL: %v", err)
	}

	pool, err := pgxpool.New(ctx, connectionString)
	if err != nil {
		t.Fatalf("connect PostgreSQL: %v", err)
	}

	t.Cleanup(pool.Close)
	created := testRoom(t, "admission-room", "admission-media", testInviteCode(t, 92))
	if err := NewRoomRepository(pool).Create(ctx, created); err != nil {
		t.Fatalf("create room: %v", err)
	}

	store := NewAdmissionRepository(pool)
	expiresAt := time.Now().Add(time.Minute)
	results := make(chan error, room.MaxParticipants+1)
	var workers sync.WaitGroup
	for index := range room.MaxParticipants + 1 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			results <- store.Reserve(ctx, created.Name(), fmt.Sprintf("participant-%d", index),
				nil, expiresAt, room.MaxParticipants)
		}()
	}

	workers.Wait()
	close(results)
	accepted, rejected := 0, 0
	for result := range results {
		switch {
		case result == nil:
			accepted++
		case errors.Is(result, room.ErrRoomFull):
			rejected++
		default:
			t.Fatalf("Reserve() unexpected error: %v", result)
		}
	}

	if accepted != room.MaxParticipants || rejected != 1 {
		t.Errorf("concurrent reservations = %d accepted, %d rejected; want %d and 1",
			accepted, rejected, room.MaxParticipants)
	}

	var first string
	if err := pool.QueryRow(ctx, "SELECT participant_identity FROM room_admissions WHERE room_name = $1 LIMIT 1",
		created.Name()).Scan(&first); err != nil {
		t.Fatalf("read first reservation: %v", err)
	}

	if err := store.Reserve(ctx, created.Name(), "replacement", []string{first}, expiresAt,
		room.MaxParticipants); !errors.Is(err, room.ErrRoomFull) {
		t.Errorf("Reserve() error = %v, want room full while all eight remain occupied", err)
	}

	if _, err := pool.Exec(ctx, `UPDATE room_admissions SET expires_at = now() - interval '1 second'
		WHERE room_name = $1 AND participant_identity <> $2 AND participant_identity =
		(SELECT participant_identity FROM room_admissions WHERE room_name = $1 AND participant_identity <> $2 LIMIT 1)`,
		created.Name(), first); err != nil {
		t.Fatalf("expire a pending admission: %v", err)
	}

	if err := store.Reserve(ctx, created.Name(), "replacement", []string{first}, expiresAt, room.MaxParticipants); err != nil {
		t.Fatalf("replace a connected reservation: %v", err)
	}

	if err := store.Reserve(ctx, created.Name(), "over-capacity", []string{first}, expiresAt,
		room.MaxParticipants); !errors.Is(err, room.ErrRoomFull) {
		t.Errorf("Reserve() error = %v, want room full", err)
	}

	if err := store.Reserve(ctx, created.Name(), "after-departure", nil, expiresAt,
		room.MaxParticipants); !errors.Is(err, room.ErrRoomFull) {
		t.Errorf("Reserve() error = %v, want room full while old token can reconnect", err)
	}
}
