package api_test

import (
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
