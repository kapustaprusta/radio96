package room

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"testing/iotest"
)

func TestGenerateInviteCode(t *testing.T) {
	entropy := make([]byte, len(inviteCodeAlphabet))
	for index := range entropy {
		entropy[index] = byte(index)
	}

	randomErr := errors.New("random source failed")
	tests := []struct {
		name    string
		random  io.Reader
		want    string
		wantErr error
	}{
		{
			name: "mixed case letters", random: bytes.NewReader(entropy),
			want: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
		},
		{
			name: "lowercase letters and digits", random: bytes.NewReader(entropy[len(entropy)-InviteCodeLength:]),
			want: "efghijklmnopqrstuvwxyz0123456789",
		},
		{
			name: "first alphabet character", random: bytes.NewReader(make([]byte, InviteCodeLength)),
			want: strings.Repeat("A", InviteCodeLength),
		},
		{
			name: "last alphabet character", random: bytes.NewReader(bytes.Repeat([]byte{61}, InviteCodeLength)),
			want: strings.Repeat("9", InviteCodeLength),
		},
		{
			name: "retries rejected random values without modulo bias",
			random: io.MultiReader(
				bytes.NewReader(bytes.Repeat([]byte{255}, InviteCodeLength)),
				bytes.NewReader(bytes.Repeat([]byte{1}, InviteCodeLength)),
			),
			want: strings.Repeat("B", InviteCodeLength),
		},
		{name: "random source error", random: iotest.ErrReader(randomErr), wantErr: randomErr},
		{
			name: "exhausted random source", random: bytes.NewReader(make([]byte, InviteCodeLength-1)),
			wantErr: io.EOF,
		},
		{
			name:    "source error after partial code",
			random:  io.MultiReader(bytes.NewReader(make([]byte, InviteCodeLength-1)), iotest.ErrReader(randomErr)),
			wantErr: randomErr,
		},
		{
			name:   "source error while retrying rejected value",
			random: io.MultiReader(bytes.NewReader([]byte{255}), iotest.ErrReader(randomErr)), wantErr: randomErr,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			code, err := GenerateInviteCode(test.random)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("GenerateInviteCode() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if code != nil {
					t.Error("GenerateInviteCode() returned a partial code on error")
				}

				return
			}

			if code == nil {
				t.Fatal("GenerateInviteCode() = nil, want invite code")
			}

			if code.Value() != test.want {
				t.Error("generated code does not match the deterministic random source")
			}

			if len(code.Value()) != 32 {
				t.Errorf("invite code length = %d, want 32", len(code.Value()))
			}

			parsed, err := ParseInviteCode(code.Value())
			if err != nil {
				t.Fatalf("ParseInviteCode() error = %v", err)
			}

			if parsed.Value() != code.Value() {
				t.Error("parsing changed the generated code")
			}
		})
	}
}

func TestParseInviteCode(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr error
	}{
		{
			name:  "mixed case letters and digits",
			value: strings.Repeat("Aa0", 10) + "Z9",
		},
		{name: "uppercase letters", value: strings.Repeat("A", 32)},
		{name: "lowercase letters", value: strings.Repeat("a", 32)},
		{name: "digits", value: strings.Repeat("0", 32)},
		{
			name:    "empty code",
			wantErr: ErrInvalidInviteCode,
		},
		{
			name:    "too short",
			value:   strings.Repeat("A", InviteCodeLength-1),
			wantErr: ErrInvalidInviteCode,
		},
		{
			name:    "too long",
			value:   strings.Repeat("A", InviteCodeLength+1),
			wantErr: ErrInvalidInviteCode,
		},
		{
			name:    "plus",
			value:   strings.Repeat("A", InviteCodeLength-1) + "+",
			wantErr: ErrInvalidInviteCode,
		},
		{
			name:    "padding",
			value:   strings.Repeat("A", 31) + "=",
			wantErr: ErrInvalidInviteCode,
		},
		{name: "legacy format", value: strings.Repeat("A", 43), wantErr: ErrInvalidInviteCode},
		{name: "hyphen", value: strings.Repeat("A", 31) + "-", wantErr: ErrInvalidInviteCode},
		{name: "underscore", value: strings.Repeat("A", 31) + "_", wantErr: ErrInvalidInviteCode},
		{name: "slash", value: strings.Repeat("A", 31) + "/", wantErr: ErrInvalidInviteCode},
		{name: "space", value: strings.Repeat("A", 31) + " ", wantErr: ErrInvalidInviteCode},
		{name: "newline", value: strings.Repeat("A", 31) + "\n", wantErr: ErrInvalidInviteCode},
		{name: "trailing newline", value: strings.Repeat("A", 32) + "\n", wantErr: ErrInvalidInviteCode},
		{name: "non-ASCII with valid byte length", value: strings.Repeat("A", 30) + "я", wantErr: ErrInvalidInviteCode},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := ParseInviteCode(test.value)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("ParseInviteCode() error = %v, want %v", err, test.wantErr)
			}

			if test.wantErr != nil {
				if got != nil {
					t.Errorf("ParseInviteCode() = %v, want nil", got)
				}

				return
			}

			if got == nil {
				t.Fatal("ParseInviteCode() = nil, want invite code")
			}

			if got.Value() != test.value {
				t.Error("ParseInviteCode() changed the code or its case")
			}
		})
	}
}

func TestInviteCodeHash(t *testing.T) {
	code, err := ParseInviteCode(strings.Repeat("A", InviteCodeLength))
	if err != nil {
		t.Fatalf("ParseInviteCode() error = %v", err)
	}

	want := sha256.Sum256([]byte(code.Value()))
	if got := code.Hash(); got != want {
		t.Errorf("Hash() = %x, want %x", got, want)
	}

	bytesValue := code.Hash().Bytes()
	bytesValue[0] ^= 0xff
	if got := code.Hash(); got != want {
		t.Errorf("mutating Bytes() result changed hash: got %x, want %x", got, want)
	}
}

func TestInviteCodeRedaction(t *testing.T) {
	code, err := ParseInviteCode(strings.Repeat("A", InviteCodeLength))
	if err != nil {
		t.Fatalf("ParseInviteCode() error = %v", err)
	}

	tests := []struct {
		name string
		got  string
	}{
		{
			name: "String",
			got:  code.String(),
		},
		{
			name: "fmt",
			got:  fmt.Sprint(code),
		},
		{
			name: "slog",
			got:  code.LogValue().String(),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.got != "[REDACTED]" {
				t.Errorf("redacted value = %q, want %q", test.got, "[REDACTED]")
			}
		})
	}
}
