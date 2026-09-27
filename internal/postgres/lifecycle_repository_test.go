package postgres

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/kapustaprusta/radio96/internal/room"
)

func TestLifecycleRepository(t *testing.T) {
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

	repository := NewLifecycleRepository(pool)
	created := testRoom(t, "lifecycle-room", "lifecycle-media", testInviteCode(t, 90))
	if err := NewRoomRepository(pool).Create(ctx, created); err != nil {
		t.Fatalf("create room: %v", err)
	}

	startedAt := created.CreatedAt().Add(time.Minute)
	firstEmptyAt := startedAt.Add(time.Minute)
	lastEmptyAt := startedAt.Add(2 * time.Minute)
	finishedAt := lastEmptyAt.Add(room.EmptyRoomLifetime)
	for _, event := range []room.LifecycleEvent{
		{ID: "start", RoomName: created.Name(), Type: "room_started", At: startedAt, Action: room.LifecycleStart},
		{ID: "start", RoomName: created.Name(), Type: "room_finished", At: firstEmptyAt, Action: room.LifecycleIdle},
		{ID: "first-empty", RoomName: created.Name(), Type: "room_finished", At: firstEmptyAt, Action: room.LifecycleIdle},
		{ID: "rejoin", RoomName: created.Name(), Type: "participant_joined", At: lastEmptyAt, Action: room.LifecycleStart},
		{ID: "last-empty", RoomName: created.Name(), Type: "participant_left", At: lastEmptyAt, Action: room.LifecycleIdle},
	} {
		if err := repository.ApplyEvent(ctx, event); err != nil {
			t.Fatalf("ApplyEvent(%q) error = %v", event.ID, err)
		}
	}

	if err := repository.Finish(ctx, created.Name(), finishedAt.Add(-time.Second)); err != nil {
		t.Fatalf("early Finish() error = %v", err)
	}

	if err := repository.Finish(ctx, created.Name(), finishedAt); err != nil {
		t.Fatalf("Finish() error = %v", err)
	}

	var status string
	var started, empty, finished time.Time
	if err := pool.QueryRow(ctx, "SELECT status, started_at, last_empty_at, finished_at FROM rooms WHERE id = $1", created.ID()).
		Scan(&status, &started, &empty, &finished); err != nil {
		t.Fatalf("read room state: %v", err)
	}

	if status != string(room.StatusFinished) || !started.Equal(startedAt) || !empty.Equal(lastEmptyAt) ||
		!finished.Equal(finishedAt) {
		t.Errorf("room = (%q, %v, %v, %v), want final empty at %v and finish at %v",
			status, started, empty, finished, lastEmptyAt, finishedAt)
	}

	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM webhook_events").Scan(&count); err != nil {
		t.Fatalf("count webhook events: %v", err)
	}

	if count != 4 {
		t.Errorf("webhook events = %d, want 4 unique IDs", count)
	}

	candidates, err := repository.Candidates(ctx, time.Now())
	if err != nil || len(candidates) != 0 {
		t.Errorf("Candidates() = (%v, %v), want none after finish", candidates, err)
	}

	recovered := testRoom(t, "recover-room", "recover-media", testInviteCode(t, 91))
	roomRepository := NewRoomRepository(pool)
	if err := roomRepository.Create(ctx, recovered); err != nil {
		t.Fatalf("create recovery room: %v", err)
	}

	if err := recovered.Expire(recovered.ExpiresAt()); err != nil {
		t.Fatalf("expire recovery room: %v", err)
	}

	if err := roomRepository.Update(ctx, recovered); err != nil {
		t.Fatalf("persist expiry: %v", err)
	}

	if err := recovered.RecoverStarted(recovered.ExpiresAt().Add(time.Minute)); err != nil {
		t.Fatalf("recover active room: %v", err)
	}

	if err := roomRepository.Update(ctx, recovered); err != nil {
		t.Fatalf("persist recovered room: %v", err)
	}

	if err := pool.QueryRow(ctx, "SELECT status FROM rooms WHERE id = $1", recovered.ID()).Scan(&status); err != nil ||
		status != string(room.StatusActive) {
		t.Errorf("recovered status = %q, error = %v; want active", status, err)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO room_admissions (room_name, participant_identity, expires_at)
		VALUES ($1, 'expired-token', $2)`, created.Name(), time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("insert expired admission: %v", err)
	}

	if err := repository.CleanupExpiredAdmissions(ctx, time.Now()); err != nil {
		t.Fatalf("cleanup expired admissions: %v", err)
	}

	if err := pool.QueryRow(ctx, "SELECT count(*) FROM room_admissions WHERE room_name = $1", created.Name()).
		Scan(&count); err != nil || count != 0 {
		t.Errorf("remaining expired admissions = %d, error = %v; want zero", count, err)
	}

	release, locked, err := repository.TryReconcileLock(ctx)
	if err != nil || !locked {
		t.Fatalf("first lock = (%t, %v), want acquired", locked, err)
	}

	_, locked, err = repository.TryReconcileLock(ctx)
	if err != nil || locked {
		t.Errorf("concurrent lock = (%t, %v), want unavailable", locked, err)
	}

	release(ctx)
	release, locked, err = repository.TryReconcileLock(ctx)
	if err != nil || !locked {
		t.Fatalf("lock after release = (%t, %v), want acquired", locked, err)
	}

	release(ctx)
}
