package api_test

import (
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
)

func TestOpenAPIDocument(t *testing.T) {
	loader := openapi3.NewLoader()
	loader.IsExternalRefsAllowed = false

	document, err := loader.LoadFromFile("openapi.yaml")
	if err != nil {
		t.Fatalf("load OpenAPI document: %v", err)
	}

	if document.OpenAPI != "3.1.2" {
		t.Fatalf("unexpected OpenAPI version: %q", document.OpenAPI)
	}

	err = document.Validate(
		t.Context(),
		openapi3.EnableExamplesValidation(),
		openapi3.EnableSchemaFormatValidation(),
		openapi3.EnableSchemaPatternValidation(),
	)

	if err != nil {
		t.Fatalf("validate OpenAPI document: %v", err)
	}
}

func TestInviteCodeSchema(t *testing.T) {
	document, err := openapi3.NewLoader().LoadFromFile("openapi.yaml")
	if err != nil {
		t.Fatalf("load OpenAPI document: %v", err)
	}

	schema := document.Components.Parameters["InviteCode"].Value.Schema.Value
	tests := []struct {
		name      string
		value     string
		wantValid bool
	}{
		{name: "uppercase", value: strings.Repeat("A", 32), wantValid: true},
		{name: "lowercase", value: strings.Repeat("a", 32), wantValid: true},
		{name: "digits", value: strings.Repeat("9", 32), wantValid: true},
		{name: "mixed alphabet", value: strings.Repeat("Aa0", 10) + "Z9", wantValid: true},
		{name: "empty"},
		{name: "short", value: strings.Repeat("A", 31)},
		{name: "long", value: strings.Repeat("A", 33)},
		{name: "legacy", value: strings.Repeat("A", 43)},
		{name: "hyphen", value: strings.Repeat("A", 31) + "-"},
		{name: "underscore", value: strings.Repeat("A", 31) + "_"},
		{name: "non-ASCII", value: strings.Repeat("A", 31) + "я"},
		{name: "space", value: strings.Repeat("A", 31) + " "},
		{name: "trailing newline", value: strings.Repeat("A", 32) + "\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := schema.VisitJSON(test.value, openapi3.EnableJSONSchema2020())
			if (err == nil) != test.wantValid {
				t.Errorf("invite schema valid = %t, want %t", err == nil, test.wantValid)
			}
		})
	}
}
