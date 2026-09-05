package room

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"strings"
)

const (
	InviteCodeLength   = 32
	inviteCodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
)

type InviteCode struct {
	value string
}

type InviteCodeHash [sha256.Size]byte

func GenerateInviteCode(random io.Reader) (*InviteCode, error) {
	value := make([]byte, InviteCodeLength)
	alphabetSize := big.NewInt(int64(len(inviteCodeAlphabet)))

	for index := range value {
		symbol, err := rand.Int(random, alphabetSize)
		if err != nil {
			return nil, fmt.Errorf("read invite code entropy: %w", err)
		}

		value[index] = inviteCodeAlphabet[symbol.Int64()]
	}

	return &InviteCode{value: string(value)}, nil
}

func ParseInviteCode(value string) (*InviteCode, error) {
	if len(value) != InviteCodeLength {
		return nil, fmt.Errorf(
			"%w: expected %d ASCII letters or digits",
			ErrInvalidInviteCode,
			InviteCodeLength,
		)
	}

	for _, symbol := range value {
		if !strings.ContainsRune(inviteCodeAlphabet, symbol) {
			return nil, fmt.Errorf("%w: expected ASCII letters or digits", ErrInvalidInviteCode)
		}
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
