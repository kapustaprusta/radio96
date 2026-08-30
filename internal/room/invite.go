package room

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
)

const (
	InviteCodeEntropyBytes = 32
	InviteCodeLength       = 43
)

type InviteCode struct {
	value string
}

type InviteCodeHash [sha256.Size]byte

func GenerateInviteCode(random io.Reader) (*InviteCode, error) {
	entropy := make([]byte, InviteCodeEntropyBytes)
	if _, err := io.ReadFull(random, entropy); err != nil {
		return nil, fmt.Errorf("read invite code entropy: %w", err)
	}

	return &InviteCode{
		value: base64.RawURLEncoding.EncodeToString(entropy),
	}, nil
}

func ParseInviteCode(value string) (*InviteCode, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(decoded) != InviteCodeEntropyBytes {
		return nil, fmt.Errorf(
			"%w: expected %d base64url characters",
			ErrInvalidInviteCode,
			InviteCodeLength,
		)
	}

	if base64.RawURLEncoding.EncodeToString(decoded) != value {
		return nil, fmt.Errorf("%w: encoding is not canonical", ErrInvalidInviteCode)
	}

	return &InviteCode{value: value}, nil
}

func (c InviteCode) Value() string {
	return c.value
}

func (c InviteCode) String() string {
	return "[REDACTED]"
}

func (c InviteCode) LogValue() slog.Value {
	return slog.StringValue(c.String())
}

func (c InviteCode) Hash() InviteCodeHash {
	return sha256.Sum256([]byte(c.value))
}

func (h InviteCodeHash) Bytes() []byte {
	value := make([]byte, len(h))
	copy(value, h[:])

	return value
}
