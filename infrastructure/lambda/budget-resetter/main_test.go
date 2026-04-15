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

func TestSetsSSMToTrue(t *testing.T) {
	mock := &mockSSM{}
	h := &handler{ssmClient: mock, ssmParam: "/test/param"}
	if err := h.handle(context.Background(), nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(mock.calls) != 1 {
		t.Fatalf("want 1 SSM call, got %d", len(mock.calls))
	}
	if *mock.calls[0].Value != "true" {
		t.Fatalf("want Value=true, got %q", *mock.calls[0].Value)
	}
}

func TestUsesCorrectParamName(t *testing.T) {
	mock := &mockSSM{}
	h := &handler{ssmClient: mock, ssmParam: "/other/path"}
	h.handle(context.Background(), nil)
	if *mock.calls[0].Name != "/other/path" {
		t.Fatalf("want Name=/other/path, got %q", *mock.calls[0].Name)
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

func TestWorksWithSchedulerEvent(t *testing.T) {
	mock := &mockSSM{}
	h := &handler{ssmClient: mock, ssmParam: "/test/param"}
	event := map[string]any{"source": "monthly-reset"}
	if err := h.handle(context.Background(), event); err != nil {
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
