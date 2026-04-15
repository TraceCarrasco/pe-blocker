package main

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/ssm"
)

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

type mockSSM struct {
	calls []*ssm.PutParameterInput
	err   error
}

func (m *mockSSM) PutParameter(_ context.Context, input *ssm.PutParameterInput, _ ...func(*ssm.Options)) (*ssm.PutParameterOutput, error) {
	m.calls = append(m.calls, input)
	return &ssm.PutParameterOutput{}, m.err
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestSetsSSMToFalse(t *testing.T) {
	mock := &mockSSM{}
	h := &handler{ssmClient: mock, ssmParam: "/test/param"}
	if err := h.handle(context.Background(), nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(mock.calls) != 1 {
		t.Fatalf("want 1 SSM call, got %d", len(mock.calls))
	}
	if *mock.calls[0].Value != "false" {
		t.Fatalf("want Value=false, got %q", *mock.calls[0].Value)
	}
}

func TestUsesCorrectParamName(t *testing.T) {
	mock := &mockSSM{}
	h := &handler{ssmClient: mock, ssmParam: "/custom/path"}
	h.handle(context.Background(), nil)
	if *mock.calls[0].Name != "/custom/path" {
		t.Fatalf("want Name=/custom/path, got %q", *mock.calls[0].Name)
	}
}

func TestCallsSSMExactlyOnce(t *testing.T) {
	mock := &mockSSM{}
	h := &handler{ssmClient: mock, ssmParam: "/test/param"}
	h.handle(context.Background(), nil)
	if len(mock.calls) != 1 {
		t.Fatalf("want 1 SSM call, got %d", len(mock.calls))
	}
}

func TestWorksWithSNSEvent(t *testing.T) {
	mock := &mockSSM{}
	h := &handler{ssmClient: mock, ssmParam: "/test/param"}
	snsEvent := map[string]any{"Records": []any{}}
	if err := h.handle(context.Background(), snsEvent); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestReturnsErrorOnSSMFailure(t *testing.T) {
	mock := &mockSSM{err: errors.New("SSM failed")}
	h := &handler{ssmClient: mock, ssmParam: "/test/param"}
	if err := h.handle(context.Background(), nil); err == nil {
		t.Fatal("want error, got nil")
	}
}

func TestOverwriteIsSet(t *testing.T) {
	mock := &mockSSM{}
	h := &handler{ssmClient: mock, ssmParam: "/test/param"}
	h.handle(context.Background(), nil)
	if mock.calls[0].Overwrite == nil || !*mock.calls[0].Overwrite {
		t.Fatal("want Overwrite=true")
	}
}
