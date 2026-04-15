import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { execSync } from 'child_process';

export class PeBlockerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -------------------------------------------------------------------------
    // DynamoDB — PE entity suggestion submissions
    // -------------------------------------------------------------------------
    const table = new dynamodb.Table(this, 'Suggestions', {
      tableName: 'pe-blocker-suggestions',
      partitionKey: { name: 'submissionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI: query submissions by platform (e.g. all "website" submissions, sorted by date)
    table.addGlobalSecondaryIndex({
      indexName: 'platform-submittedAt-index',
      partitionKey: { name: 'platform', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'submittedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -------------------------------------------------------------------------
    // SSM Parameter — kill-switch for submissions when budget is exceeded
    // -------------------------------------------------------------------------
    const enabledParam = new ssm.StringParameter(this, 'SubmissionsEnabled', {
      parameterName: '/pe-blocker/submissions-enabled',
      stringValue: 'true',
      description: '"true" = accepting submissions; "false" = budget exceeded, silently dropping',
    });

    // -------------------------------------------------------------------------
    // Lambda helpers
    // -------------------------------------------------------------------------

    // Builds a Go Lambda binary locally (GOARCH=arm64 GOOS=linux), falling
    // back to Docker if the Go toolchain is unavailable.
    const goCode = (sourceDir: string): lambda.AssetCode =>
      lambda.Code.fromAsset(sourceDir, {
        bundling: {
          image: cdk.DockerImage.fromRegistry('public.ecr.aws/docker/library/golang:1.22-alpine'),
          command: [
            'sh', '-c',
            'GOARCH=arm64 GOOS=linux CGO_ENABLED=0 go build -o /asset-output/bootstrap .',
          ],
          local: {
            tryBundle(outputDir: string): boolean {
              try {
                execSync(
                  'GOARCH=arm64 GOOS=linux CGO_ENABLED=0 go build -o ' +
                  path.join(outputDir, 'bootstrap') + ' .',
                  { cwd: sourceDir, stdio: 'pipe' },
                );
                return true;
              } catch {
                return false;
              }
            },
          },
        },
      });

    const lambdaDefaults = {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      timeout: cdk.Duration.seconds(10),
      architecture: lambda.Architecture.ARM_64,
    };

    // Lambda: submit-suggestion
    const submitFn = new lambda.Function(this, 'SubmitSuggestion', {
      ...lambdaDefaults,
      functionName: 'pe-blocker-submit-suggestion',
      code: goCode(path.join(__dirname, '../lambda/submit-suggestion')),
      environment: {
        TABLE_NAME: table.tableName,
        SSM_PARAM: enabledParam.parameterName,
      },
    });
    table.grantWriteData(submitFn);
    enabledParam.grantRead(submitFn);

    // Lambda: budget-enforcer — sets SSM flag to "false"
    const enforcerFn = new lambda.Function(this, 'BudgetEnforcer', {
      ...lambdaDefaults,
      functionName: 'pe-blocker-budget-enforcer',
      code: goCode(path.join(__dirname, '../lambda/budget-enforcer')),
      environment: {
        SSM_PARAM: enabledParam.parameterName,
      },
    });
    enabledParam.grantWrite(enforcerFn);

    // Lambda: budget-resetter — sets SSM flag back to "true" on 1st of month
    const resetterFn = new lambda.Function(this, 'BudgetResetter', {
      ...lambdaDefaults,
      functionName: 'pe-blocker-budget-resetter',
      code: goCode(path.join(__dirname, '../lambda/budget-resetter')),
      environment: {
        SSM_PARAM: enabledParam.parameterName,
      },
    });
    enabledParam.grantWrite(resetterFn);

    // -------------------------------------------------------------------------
    // SNS topic + AWS Budgets — $20/month hard cap
    // -------------------------------------------------------------------------
    const budgetTopic = new sns.Topic(this, 'BudgetAlertTopic', {
      topicName: 'pe-blocker-budget-alerts',
    });

    // Allow AWS Budgets service to publish to the topic
    budgetTopic.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
      actions: ['SNS:Publish'],
      resources: [budgetTopic.topicArn],
      conditions: {
        StringEquals: { 'aws:SourceAccount': this.account },
      },
    }));

    budgetTopic.addSubscription(new snsSubscriptions.LambdaSubscription(enforcerFn));

    new budgets.CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: 20, unit: 'USD' },
        budgetName: 'pe-blocker-monthly',
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,         // 100% of $20
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            { subscriptionType: 'SNS', address: budgetTopic.topicArn },
          ],
        },
      ],
    });

    // -------------------------------------------------------------------------
    // EventBridge Scheduler — re-enable submissions on 1st of each month
    // -------------------------------------------------------------------------
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to invoke the budget-resetter Lambda',
    });
    resetterFn.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'MonthlyBudgetReset', {
      name: 'pe-blocker-monthly-budget-reset',
      description: 'Re-enables DynamoDB submissions at the start of each billing cycle',
      scheduleExpression: 'cron(0 0 1 * ? *)',  // 1st of every month, 00:00 UTC
      scheduleExpressionTimezone: 'UTC',
      target: {
        arn: resetterFn.functionArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ source: 'monthly-reset' }),
      },
      flexibleTimeWindow: { mode: 'OFF' },
    });

    // -------------------------------------------------------------------------
    // API Gateway
    // -------------------------------------------------------------------------
    const api = new apigateway.RestApi(this, 'PeBlockerApi', {
      restApiName: 'pe-blocker-api',
      deployOptions: { stageName: 'prod' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
      },
    });

    const suggestions = api.root.addResource('suggestions');
    suggestions.addMethod('POST', new apigateway.LambdaIntegration(submitFn));

    // -------------------------------------------------------------------------
    // WAF WebACL (CLOUDFRONT scope — must be in us-east-1)
    // -------------------------------------------------------------------------
    const visConfig = (name: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      metricName: name,
      sampledRequestsEnabled: true,
    });

    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: 'pe-blocker-waf',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visConfig('pe-blocker-waf'),
      rules: [
        // Rate limit: block any IP that sends more than 100 requests per 5 minutes
        {
          name: 'RateLimit',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 100,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: visConfig('RateLimit'),
        },
        // AWS managed rules: protect against common web exploits (SQLi, XSS, etc.)
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: visConfig('AWSManagedRulesCommonRuleSet'),
        },
      ],
    });

    // -------------------------------------------------------------------------
    // CloudFront Distribution
    // -------------------------------------------------------------------------
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.RestApiOrigin(api),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      webAclId: webAcl.attrArn,
      comment: 'PE Blocker channel suggestion API',
    });

    // -------------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `https://${distribution.distributionDomainName}/suggestions`,
      description: 'Paste this value into popup.js as API_URL',
    });

    new cdk.CfnOutput(this, 'SuggestionsTableName', {
      value: table.tableName,
      description: 'DynamoDB table where channel suggestions are stored',
    });
  }
}
