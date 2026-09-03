package postgres

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/kapustaprusta/radio96/internal/room"
)

const (
	testDatabaseName = "radio96"
	testDatabaseUser = "radio96"
	testDatabasePass = "radio96"
)

var testRoomCreatedAt = time.Date(2026, time.September, 1, 9, 0, 0, 0, time.UTC)

func TestRoomRepository(t *testing.T) {
	testcontainers.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)

	container, err := tcpostgres.Run(
		ctx,
		"postgres:17-alpine",
		tcpostgres.WithDatabase(testDatabaseName),
		tcpostgres.WithUsername(testDatabaseUser),
		tcpostgres.WithPassword(testDatabasePass),
		tcpostgres.WithInitScripts(filepath.Join("..", "..", "db", "migrations", "000001_create_rooms.up.sql")),
		tcpostgres.BasicWaitStrategies(),
	)
	testcontainers.CleanupContainer(t, container)
	if err != nil {
		t.Fatalf("start PostgreSQL container: %v", err)
	}

	connectionString, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get PostgreSQL connection string: %v", err)
	}

	pool, err := pgxpool.New(ctx, connectionString)
	if err != nil {
		t.Fatalf("connect to PostgreSQL: %v", err)
	}

	t.Cleanup(pool.Close)

	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping PostgreSQL: %v", err)
	}

	repository := NewRoomRepository(pool)

	t.Run("create and find", func(t *testing.T) {
		truncateRooms(t, ctx, pool)

		inviteCode := testInviteCode(t, 1)
		createdRoom := testRoom(t, "room-create-find", "room-create-find", inviteCode)

		if err := repository.Create(ctx, createdRoom); err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		got, err := repository.FindByInviteCode(ctx, inviteCode)
		if err != nil {
			t.Fatalf("FindByInviteCode() error = %v", err)
		}

		assertRoomEqual(t, got, createdRoom)
		assertStoredInviteCode(t, ctx, pool, createdRoom)
	})

	t.Run("find unknown room", func(t *testing.T) {
		truncateRooms(t, ctx, pool)

		got, err := repository.FindByInviteCode(ctx, testInviteCode(t, 2))
		if !errors.Is(err, room.ErrRoomNotFound) {
			t.Fatalf("FindByInviteCode() error = %v, want %v", err, room.ErrRoomNotFound)
		}

		if got != nil {
			t.Errorf("FindByInviteCode() = %v, want nil", got)
		}
	})

	t.Run("lifecycle transitions", func(t *testing.T) {
		tests := []struct {
			name           string
			inviteCodeFill byte
			transitions    []func(*room.Room) error
			wantStatus     room.Status
		}{
			{
				name:           "open to active",
				inviteCodeFill: 10,
				transitions: []func(*room.Room) error{
					func(candidate *room.Room) error {
						return candidate.Start(testRoomCreatedAt.Add(time.Minute))
					},
				},
				wantStatus: room.StatusActive,
			},
			{
				name:           "open to active to finished",
				inviteCodeFill: 11,
				transitions: []func(*room.Room) error{
					func(candidate *room.Room) error {
						return candidate.Start(testRoomCreatedAt.Add(time.Minute))
					},
					func(candidate *room.Room) error {
						return candidate.Finish(testRoomCreatedAt.Add(2 * time.Minute))
					},
				},
				wantStatus: room.StatusFinished,
			},
			{
				name:           "open to expired",
				inviteCodeFill: 12,
				transitions: []func(*room.Room) error{
					func(candidate *room.Room) error {
						return candidate.Expire(testRoomCreatedAt.Add(room.OpenRoomLifetime))
					},
				},
				wantStatus: room.StatusExpired,
			},
		}

		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				truncateRooms(t, ctx, pool)

				inviteCode := testInviteCode(t, test.inviteCodeFill)
				createdRoom := testRoom(t, "room-lifecycle", "room-lifecycle", inviteCode)

				if err := repository.Create(ctx, createdRoom); err != nil {
					t.Fatalf("Create() error = %v", err)
				}

				for _, transition := range test.transitions {
					if err := transition(createdRoom); err != nil {
						t.Fatalf("transition error = %v", err)
					}

					if err := repository.Update(ctx, createdRoom); err != nil {
						t.Fatalf("Update() error = %v", err)
					}
				}

				got, err := repository.FindByInviteCode(ctx, inviteCode)
				if err != nil {
					t.Fatalf("FindByInviteCode() error = %v", err)
				}

				if got.Status() != test.wantStatus {
					t.Errorf("Status() = %q, want %q", got.Status(), test.wantStatus)
				}

				assertRoomEqual(t, got, createdRoom)
			})
		}
	})

	t.Run("rejects stale transition", func(t *testing.T) {
		truncateRooms(t, ctx, pool)

		inviteCode := testInviteCode(t, 20)
		createdRoom := testRoom(t, "room-stale-update", "room-stale-update", inviteCode)

		if err := repository.Create(ctx, createdRoom); err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		startedRoom, err := repository.FindByInviteCode(ctx, inviteCode)
		if err != nil {
			t.Fatalf("load room to start: %v", err)
		}

		staleRoom, err := repository.FindByInviteCode(ctx, inviteCode)
		if err != nil {
			t.Fatalf("load stale room: %v", err)
		}

		if err := startedRoom.Start(testRoomCreatedAt.Add(time.Minute)); err != nil {
			t.Fatalf("Start() error = %v", err)
		}

		if err := repository.Update(ctx, startedRoom); err != nil {
			t.Fatalf("Update(started room) error = %v", err)
		}

		if err := staleRoom.Expire(testRoomCreatedAt.Add(room.OpenRoomLifetime)); err != nil {
			t.Fatalf("Expire() error = %v", err)
		}

		if err := repository.Update(ctx, staleRoom); !errors.Is(err, room.ErrConcurrentRoomUpdate) {
			t.Fatalf("Update(stale room) error = %v, want %v", err, room.ErrConcurrentRoomUpdate)
		}
	})
}

func testInviteCode(t *testing.T, fill byte) *room.InviteCode {
	t.Helper()

	value := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{fill}, room.InviteCodeEntropyBytes))
	inviteCode, err := room.ParseInviteCode(value)
	if err != nil {
		t.Fatalf("ParseInviteCode() error = %v", err)
	}

	return inviteCode
}

func testRoom(t *testing.T, id, name string, inviteCode *room.InviteCode) *room.Room {
	t.Helper()

	createdRoom, err := room.New(id, inviteCode, name, testRoomCreatedAt)
	if err != nil {
		t.Fatalf("room.New() error = %v", err)
	}

	return createdRoom
}

func truncateRooms(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()

	if _, err := pool.Exec(ctx, "TRUNCATE TABLE rooms"); err != nil {
		t.Fatalf("truncate rooms: %v", err)
	}
}

func assertStoredInviteCode(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	createdRoom *room.Room,
) {
	t.Helper()

	var storedHash []byte
	if err := pool.QueryRow(
		ctx,
		"SELECT invite_code_hash FROM rooms WHERE id = $1",
		createdRoom.ID(),
	).Scan(&storedHash); err != nil {
		t.Fatalf("read stored invite code hash: %v", err)
	}

	wantHash := createdRoom.InviteCode().Hash().Bytes()
	if !bytes.Equal(storedHash, wantHash) {
		t.Errorf("stored invite code hash = %x, want %x", storedHash, wantHash)
	}

	if bytes.Contains(storedHash, []byte(createdRoom.InviteCode().Value())) {
		t.Error("stored invite code hash contains the raw invite code")
	}
}

func assertRoomEqual(t *testing.T, got, want *room.Room) {
	t.Helper()

	if got.ID() != want.ID() || got.Name() != want.Name() || got.Status() != want.Status() {
		t.Errorf(
			"room identity = (%q, %q, %q), want (%q, %q, %q)",
			got.ID(),
			got.Name(),
			got.Status(),
			want.ID(),
			want.Name(),
			want.Status(),
		)
	}

	if got.InviteCode().Value() != want.InviteCode().Value() {
		t.Errorf("InviteCode().Value() = %q, want %q", got.InviteCode().Value(), want.InviteCode().Value())
	}

	if !got.CreatedAt().Equal(want.CreatedAt()) || !got.ExpiresAt().Equal(want.ExpiresAt()) {
		t.Errorf(
			"room lifetime = (%v, %v), want (%v, %v)",
			got.CreatedAt(),
			got.ExpiresAt(),
			want.CreatedAt(),
			want.ExpiresAt(),
		)
	}

	assertOptionalTimeEqual(t, "StartedAt", got.StartedAt, want.StartedAt)
	assertOptionalTimeEqual(t, "FinishedAt", got.FinishedAt, want.FinishedAt)
}

func assertOptionalTimeEqual(
	t *testing.T,
	name string,
	gotGetter func() (time.Time, bool),
	wantGetter func() (time.Time, bool),
) {
	t.Helper()

	got, gotOK := gotGetter()
	want, wantOK := wantGetter()
	if gotOK != wantOK || (gotOK && !got.Equal(want)) {
		t.Errorf("%s() = (%v, %t), want (%v, %t)", name, got, gotOK, want, wantOK)
	}
}
