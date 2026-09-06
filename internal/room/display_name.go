package room

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const MaxDisplayNameLength = 32

type DisplayName struct {
	value string
}

func NewDisplayName(value string) (*DisplayName, error) {
	value = strings.TrimSpace(value)
	if !utf8.ValidString(value) {
		return nil, fmt.Errorf("%w: must be valid UTF-8", ErrInvalidDisplayName)
	}

	length := utf8.RuneCountInString(value)
	if length == 0 || length > MaxDisplayNameLength {
		return nil, fmt.Errorf(
			"%w: must contain from 1 to %d Unicode code points after trim",
			ErrInvalidDisplayName,
			MaxDisplayNameLength,
		)
	}

	return &DisplayName{value: value}, nil
}

func (n DisplayName) String() string {
	return n.value
}
