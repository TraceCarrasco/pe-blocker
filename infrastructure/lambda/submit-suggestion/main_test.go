package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	ssmtypes "github.com/aws/aws-sdk-go-v2/service/ssm/types"
)

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type mockSSM struct {
	value string
	err   error
}

func (m *mockSSM) GetParameter(_ context.Context, _ *ssm.GetParameterInput, _ ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
	if m.err != nil {
		return nil, m.err
	}
	return &ssm.GetParameterOutput{
		Parameter: &ssmtypes.Parameter{Value: aws.String(m.value)},
	}, nil
}

type mockDDB struct {
	calls []*dynamodb.PutItemInput
	err   error
}

func (m *mockDDB) PutItem(_ context.Context, input *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	m.calls = append(m.calls, input)
	return &dynamodb.PutItemOutput{}, m.err
}

// countingSSM tracks how many times GetParameter is called.
type countingSSM struct {
	value string
	calls int
}

func (c *countingSSM) GetParameter(_ context.Context, _ *ssm.GetParameterInput, _ ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
	c.calls++
	return &ssm.GetParameterOutput{
		Parameter: &ssmtypes.Parameter{Value: aws.String(c.value)},
	}, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newTestHandler(ssmVal string, ssmErr error, ddb *mockDDB) *handler {
	return &handler{
		ssmClient: &mockSSM{value: ssmVal, err: ssmErr},
		ddbClient: ddb,
		tableName: "test-table",
		ssmParam:  "/test/param",
		cache:     &ssmCache{ttl: 60 * time.Second},
	}
}

func post(body string) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{HTTPMethod: "POST", Body: body}
}

func attrString(t *testing.T, item map[string]ddbtypes.AttributeValue, key string) string {
	t.Helper()
	v, ok := item[key]
	if !ok {
		t.Fatalf("missing attribute %q", key)
	}
	sv, ok := v.(*ddbtypes.AttributeValueMemberS)
	if !ok {
		t.Fatalf("attribute %q is not a string type", key)
	}
	return sv.Value
}

// ---------------------------------------------------------------------------
// CORS pre-flight
// ---------------------------------------------------------------------------

func TestOptionsPreflight(t *testing.T) {
	h := newTestHandler("true", nil, &mockDDB{})
	res, _ := h.handle(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "OPTIONS"})
	if res.StatusCode != 200 {
		t.Fatalf("want 200, got %d", res.StatusCode)
	}
	if res.Headers["Access-Control-Allow-Origin"] != "*" {
		t.Fatal("missing CORS header")
	}
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

func TestValidSubmission(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	res, _ := h.handle(context.Background(), post(`{"channelName":"Test Channel","channelUrl":"https://youtube.com/@test","platform":"youtube"}`))
	if res.StatusCode != 200 {
		t.Fatalf("want 200, got %d", res.StatusCode)
	}
	var body map[string]bool
	json.Unmarshal([]byte(res.Body), &body)
	if !body["success"] {
		t.Fatal("want success:true")
	}
}

func TestWritesOneDDBItem(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	h.handle(context.Background(), post(`{"channelName":"Test"}`))
	if len(ddb.calls) != 1 {
		t.Fatalf("want 1 DDB call, got %d", len(ddb.calls))
	}
}

func TestItemFields(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	h.handle(context.Background(), post(`{"channelName":"Test","channelUrl":"https://youtube.com/@t","platform":"youtube"}`))
	item := ddb.calls[0].Item

	if attrString(t, item, "channelName") != "Test" {
		t.Fatal("wrong channelName")
	}
	if attrString(t, item, "channelUrl") != "https://youtube.com/@t" {
		t.Fatal("wrong channelUrl")
	}
	if attrString(t, item, "platform") != "youtube" {
		t.Fatal("wrong platform")
	}
	if attrString(t, item, "status") != "pending" {
		t.Fatal("wrong status")
	}
	if _, ok := item["submissionId"]; !ok {
		t.Fatal("missing submissionId")
	}
	if _, ok := item["submittedAt"]; !ok {
		t.Fatal("missing submittedAt")
	}
}

func TestWritesToCorrectTable(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	h.handle(context.Background(), post(`{"channelName":"Test"}`))
	if aws.ToString(ddb.calls[0].TableName) != "test-table" {
		t.Fatalf("wrong table: %s", aws.ToString(ddb.calls[0].TableName))
	}
}

func TestChannelURLOptional(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	res, _ := h.handle(context.Background(), post(`{"channelName":"Test"}`))
	if res.StatusCode != 200 {
		t.Fatalf("want 200, got %d", res.StatusCode)
	}
}

func TestResponseHasCORSHeader(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	res, _ := h.handle(context.Background(), post(`{"channelName":"Test"}`))
	if res.Headers["Access-Control-Allow-Origin"] != "*" {
		t.Fatal("missing CORS header on POST response")
	}
}

// ---------------------------------------------------------------------------
// Platform normalisation
// ---------------------------------------------------------------------------

func TestPlatformNormalisation(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"youtube", "youtube"},
		{"website", "website"},
		{"other", "other"},
		{"", "other"},
		{"unknown", "other"},
		{"YOUTUBE", "other"}, // uppercase — normalised to lower then matched; "YOUTUBE" -> "youtube" wait no...
	}
	// Correct: we ToLower before matching, so "YOUTUBE" -> "youtube" -> valid.
	// Adjust case:
	cases[5] = struct{ input, want string }{"YOUTUBE", "youtube"}

	for _, tc := range cases {
		ddb := &mockDDB{}
		h := newTestHandler("true", nil, ddb)
		var body string
		if tc.input == "" {
			body = `{"channelName":"T"}`
		} else {
			body = `{"channelName":"T","platform":"` + tc.input + `"}`
		}
		h.handle(context.Background(), post(body))
		if got := attrString(t, ddb.calls[0].Item, "platform"); got != tc.want {
			t.Errorf("platform %q: want %q, got %q", tc.input, tc.want, got)
		}
	}
}

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

func TestMissingChannelName(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	res, _ := h.handle(context.Background(), post(`{"channelUrl":"https://example.com"}`))
	if res.StatusCode != 400 {
		t.Fatalf("want 400, got %d", res.StatusCode)
	}
	if len(ddb.calls) != 0 {
		t.Fatal("should not write to DDB")
	}
}

func TestEmptyChannelName(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	res, _ := h.handle(context.Background(), post(`{"channelName":"   "}`))
	if res.StatusCode != 400 {
		t.Fatalf("want 400, got %d", res.StatusCode)
	}
}

func TestInvalidJSON(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	res, _ := h.handle(context.Background(), post("not json"))
	if res.StatusCode != 400 {
		t.Fatalf("want 400, got %d", res.StatusCode)
	}
	if len(ddb.calls) != 0 {
		t.Fatal("should not write to DDB")
	}
}

func TestTruncatesChannelName(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	long := strings.Repeat("A", 300)
	b, _ := json.Marshal(map[string]string{"channelName": long})
	h.handle(context.Background(), post(string(b)))
	got := attrString(t, ddb.calls[0].Item, "channelName")
	if len(got) != 200 {
		t.Fatalf("want 200 chars, got %d", len(got))
	}
}

func TestTruncatesChannelURL(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("true", nil, ddb)
	long := "https://youtube.com/" + strings.Repeat("x", 600)
	b, _ := json.Marshal(map[string]string{"channelName": "Test", "channelUrl": long})
	h.handle(context.Background(), post(string(b)))
	got := attrString(t, ddb.calls[0].Item, "channelUrl")
	if len(got) != 500 {
		t.Fatalf("want 500 chars, got %d", len(got))
	}
}

// ---------------------------------------------------------------------------
// Budget kill-switch
// ---------------------------------------------------------------------------

func TestKillSwitchDisabled(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("false", nil, ddb)
	res, _ := h.handle(context.Background(), post(`{"channelName":"Test"}`))
	if res.StatusCode != 200 {
		t.Fatalf("want 200, got %d", res.StatusCode)
	}
	var body map[string]bool
	json.Unmarshal([]byte(res.Body), &body)
	if body["success"] {
		t.Fatal("want success:false when kill-switch is off")
	}
	if len(ddb.calls) != 0 {
		t.Fatal("should not write to DDB when disabled")
	}
}

func TestSSMUnreachableFailsSafe(t *testing.T) {
	ddb := &mockDDB{}
	h := newTestHandler("", errors.New("SSM unavailable"), ddb)
	res, _ := h.handle(context.Background(), post(`{"channelName":"Test"}`))
	if res.StatusCode != 200 {
		t.Fatalf("want 200, got %d", res.StatusCode)
	}
	if len(ddb.calls) != 0 {
		t.Fatal("should not write to DDB when SSM is unreachable")
	}
}

// ---------------------------------------------------------------------------
// SSM in-memory cache
// ---------------------------------------------------------------------------

func TestSSMCachedWithinTTL(t *testing.T) {
	counter := &countingSSM{value: "true"}
	ddb := &mockDDB{}
	h := &handler{
		ssmClient: counter,
		ddbClient: ddb,
		tableName: "test-table",
		ssmParam:  "/test/param",
		cache:     &ssmCache{ttl: 60 * time.Second},
	}
	h.handle(context.Background(), post(`{"channelName":"T"}`))
	h.handle(context.Background(), post(`{"channelName":"T"}`))
	if counter.calls != 1 {
		t.Fatalf("want 1 SSM call (second should use cache), got %d", counter.calls)
	}
}
