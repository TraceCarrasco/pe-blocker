package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
)

// Narrow interfaces — allow mocking in tests without external mock libraries.

type ssmGetterAPI interface {
	GetParameter(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error)
}

type ddbPutterAPI interface {
	PutItem(ctx context.Context, params *dynamodb.PutItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
}

var corsHeaders = map[string]string{
	"Access-Control-Allow-Origin":  "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Content-Type":                 "application/json",
}

var validPlatforms = map[string]bool{
	"youtube": true,
	"website": true,
	"other":   true,
}

// ssmCache caches the SSM flag value for cacheTTL to avoid a round-trip on
// every Lambda invocation.
type ssmCache struct {
	mu     sync.Mutex
	value  *bool
	expiry time.Time
	ttl    time.Duration
}

func (c *ssmCache) get() (bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.value != nil && time.Now().Before(c.expiry) {
		return *c.value, true
	}
	return false, false
}

func (c *ssmCache) set(v bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value = &v
	c.expiry = time.Now().Add(c.ttl)
}

func (c *ssmCache) reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value = nil
}

type handler struct {
	ssmClient ssmGetterAPI
	ddbClient ddbPutterAPI
	tableName string
	ssmParam  string
	cache     *ssmCache
}

type requestBody struct {
	ChannelName string `json:"channelName"`
	ChannelURL  string `json:"channelUrl"`
	Platform    string `json:"platform"`
}

func (h *handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if req.HTTPMethod == http.MethodOptions {
		return events.APIGatewayProxyResponse{StatusCode: 200, Headers: corsHeaders, Body: ""}, nil
	}

	// Check kill-switch (cached for TTL duration).
	enabled, _ := h.isEnabled(ctx)
	if !enabled {
		return jsonResp(200, map[string]bool{"success": false}), nil
	}

	var body requestBody
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return jsonResp(400, map[string]string{"error": "invalid request body"}), nil
	}

	channelName := strings.TrimSpace(body.ChannelName)
	if channelName == "" {
		return jsonResp(400, map[string]string{"error": "channelName is required"}), nil
	}
	if len(channelName) > 200 {
		channelName = channelName[:200]
	}

	channelURL := strings.TrimSpace(body.ChannelURL)
	if len(channelURL) > 500 {
		channelURL = channelURL[:500]
	}

	platform := strings.ToLower(strings.TrimSpace(body.Platform))
	if !validPlatforms[platform] {
		platform = "other"
	}

	_, err := h.ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(h.tableName),
		Item: map[string]ddbtypes.AttributeValue{
			"submissionId": &ddbtypes.AttributeValueMemberS{Value: newUUID()},
			"channelName":  &ddbtypes.AttributeValueMemberS{Value: channelName},
			"channelUrl":   &ddbtypes.AttributeValueMemberS{Value: channelURL},
			"platform":     &ddbtypes.AttributeValueMemberS{Value: platform},
			"submittedAt":  &ddbtypes.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
			"status":       &ddbtypes.AttributeValueMemberS{Value: "pending"},
		},
	})
	if err != nil {
		log.Printf("DynamoDB PutItem error: %v", err)
		return jsonResp(500, map[string]string{"error": "internal error"}), nil
	}

	return jsonResp(200, map[string]bool{"success": true}), nil
}

func (h *handler) isEnabled(ctx context.Context) (bool, error) {
	if v, ok := h.cache.get(); ok {
		return v, nil
	}
	out, err := h.ssmClient.GetParameter(ctx, &ssm.GetParameterInput{
		Name: aws.String(h.ssmParam),
	})
	if err != nil {
		h.cache.set(false)
		return false, err
	}
	enabled := aws.ToString(out.Parameter.Value) == "true"
	h.cache.set(enabled)
	return enabled, nil
}

func jsonResp(status int, body any) events.APIGatewayProxyResponse {
	b, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers:    corsHeaders,
		Body:       string(b),
	}
}

// newUUID returns a random v4 UUID using only the standard library.
func newUUID() string {
	var buf [16]byte
	_, _ = rand.Read(buf[:])
	buf[6] = (buf[6] & 0x0f) | 0x40 // version 4
	buf[8] = (buf[8] & 0x3f) | 0x80 // variant RFC 4122
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16])
}

// globalHandler is initialised once per Lambda cold-start.
var globalHandler *handler

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("unable to load AWS config: %v", err)
	}
	globalHandler = &handler{
		ssmClient: ssm.NewFromConfig(cfg),
		ddbClient: dynamodb.NewFromConfig(cfg),
		tableName: os.Getenv("TABLE_NAME"),
		ssmParam:  os.Getenv("SSM_PARAM"),
		cache:     &ssmCache{ttl: 60 * time.Second},
	}
}

func main() {
	lambda.Start(globalHandler.handle)
}
