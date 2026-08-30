package room

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"testing"
	"testing/iotest"
)

func TestGenerateInviteCode(t *testing.T) {
	entropy := make([]byte, InviteCodeEntropyBytes)
	for index := range entropy {
		entropy[index] = byte(index)
	}

	code, err := GenerateInviteCode(bytes.NewReader(entropy))
	if err != nil {
		t.Fatalf("GenerateInviteCode() error = %v", err)
	}

	if code == nil {
		t.Fatal("GenerateInviteCode() = nil, want invite code")
	}

	if len(code.Value()) != InviteCodeLength {
		t.Errorf("invite code length = %d, want %d", len(code.Value()), InviteCodeLength)
	}

	parsed, err := ParseInviteCode(code.Value())
	if err != nil {
		t.Fatalf("ParseInviteCode() error = %v", err)
	}

	if parsed.Value() != code.Value() {
		t.Errorf("parsed invite code = %q, want %q", parsed.Value(), code.Value())
	}
}

func TestGenerateInviteCodeRandomError(t *testing.T) {
	randomErr := errors.New("random source failed")

	code, err := GenerateInviteCode(iotest.ErrReader(randomErr))
	if !errors.Is(err, randomErr) {
		t.Fatalf("GenerateInviteCode() error = %v, want %v", err, randomErr)
	}

	if code != nil {
		t.Errorf("GenerateInviteCode() = %v, want nil", code)
	}
}

func TestParseInviteCode(t *testing.T) {
	validCode, err := GenerateInviteCode(bytes.NewReader(make([]byte, InviteCodeEntropyBytes)))
	if err != nil {
		t.Fatalf("GenerateInviteCode() error = %v", err)
	}

	tests := []struct {
		name    string
		value   string
		wantErr error
	}{
		{
			name:  "valid code",
			value: validCode.Value(),
		},
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
			name:    "standard base64 character",
			value:   strings.Repeat("A", InviteCodeLength-1) + "+",
			wantErr: ErrInvalidInviteCode,
		},
		{
			name:    "padding",
			value:   validCode.Value() + "=",
			wantErr: ErrInvalidInviteCode,
		},
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
