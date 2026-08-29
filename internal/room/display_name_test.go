package room

import (
	"errors"
	"strings"
	"testing"
)

func TestNewDisplayName(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    string
		wantErr error
	}{
		{
			name:  "plain name",
			value: "Alice",
			want:  "Alice",
		},
		{
			name:  "trims surrounding Unicode whitespace",
			value: "\u00a0  Игрок  \u00a0",
			want:  "Игрок",
		},
		{
			name:  "accepts emoji and Cyrillic",
			value: "🎮 Капуста",
			want:  "🎮 Капуста",
		},
		{
			name:  "accepts exactly maximum code points",
			value: strings.Repeat("я", MaxDisplayNameLength),
			want:  strings.Repeat("я", MaxDisplayNameLength),
		},
		{
			name:    "rejects empty value",
			wantErr: ErrInvalidDisplayName,
		},
		{
			name:    "rejects whitespace",
			value:   " \t\n ",
			wantErr: ErrInvalidDisplayName,
		},
		{
			name:    "rejects value above maximum code points",
			value:   strings.Repeat("🎮", MaxDisplayNameLength+1),
			wantErr: ErrInvalidDisplayName,
		},
		{
			name:    "rejects invalid UTF-8",
			value:   string([]byte{0xff}),
			wantErr: ErrInvalidDisplayName,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NewDisplayName(test.value)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("NewDisplayName() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if got != nil {
					t.Errorf("NewDisplayName() = %v, want nil", got)
				}

				return
			}

			if got == nil {
				t.Fatal("NewDisplayName() = nil, want display name")
			}

			if got.String() != test.want {
				t.Errorf("NewDisplayName() = %q, want %q", got, test.want)
			}
		})
	}
}
