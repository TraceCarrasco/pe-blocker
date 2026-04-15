package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
)

// ssmPutterAPI allows mocking the SSM client in tests.
type ssmPutterAPI interface {
	PutParameter(ctx context.Context, params *ssm.PutParameterInput, optFns ...func(*ssm.Options)) (*ssm.PutParameterOutput, error)
}

type handler struct {
	ssmClient ssmPutterAPI
	ssmParam  string
}

// handle is triggered by EventBridge Scheduler on the 1st of each month (00:00 UTC).
// It sets the submissions-enabled flag back to "true", restoring normal submission
// behaviour for the new billing cycle.
func (h *handler) handle(ctx context.Context, event any) error {
	log.Printf("Monthly budget reset — re-enabling submissions: %v", event)

	_, err := h.ssmClient.PutParameter(ctx, &ssm.PutParameterInput{
		Name:      aws.String(h.ssmParam),
		Value:     aws.String("true"),
		Overwrite: aws.Bool(true),
	})
	if err != nil {
		return fmt.Errorf("SSM PutParameter: %w", err)
	}

	log.Printf("Set %s = \"true\"", h.ssmParam)
	return nil
}

var globalHandler *handler

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("unable to load AWS config: %v", err)
	}
	globalHandler = &handler{
		ssmClient: ssm.NewFromConfig(cfg),
		ssmParam:  os.Getenv("SSM_PARAM"),
	}
}

func main() {
	lambda.Start(globalHandler.handle)
}
