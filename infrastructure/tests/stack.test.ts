import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PeBlockerStack } from '../lib/stack';

// Synthesise once and reuse across all assertions.
// CDK_BUNDLING_STACKS='' tells CDK to skip Go compilation during synthesis so
// the unit tests don't require the Go toolchain to be present.
let template: Template;

beforeAll(() => {
  process.env.CDK_BUNDLING_STACKS = '';
  const app = new cdk.App();
  const stack = new PeBlockerStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  template = Template.fromStack(stack);
  delete process.env.CDK_BUNDLING_STACKS;
});

// ---------------------------------------------------------------------------
// DynamoDB
// ---------------------------------------------------------------------------

describe('DynamoDB', () => {
  test('creates a PAY_PER_REQUEST table named pe-blocker-suggestions', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'pe-blocker-suggestions',
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('table has submissionId as the partition key', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'submissionId', KeyType: 'HASH' }],
    });
  });

  test('table has a RETAIN deletion policy', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
    });
  });

  test('table has a platform-submittedAt GSI', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'platform-submittedAt-index',
          KeySchema: Match.arrayWith([
            { AttributeName: 'platform',    KeyType: 'HASH'  },
            { AttributeName: 'submittedAt', KeyType: 'RANGE' },
          ]),
          Projection: { ProjectionType: 'ALL' },
        }),
      ]),
    });
  });
});

// ---------------------------------------------------------------------------
// SSM
// ---------------------------------------------------------------------------

describe('SSM Parameter', () => {
  test('creates the submissions-enabled parameter with value "true"', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/pe-blocker/submissions-enabled',
      Value: 'true',
      Type: 'String',
    });
  });
});

// ---------------------------------------------------------------------------
// Lambda functions
// ---------------------------------------------------------------------------

describe('Lambda functions', () => {
  test('creates exactly three Lambda functions', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
  });

  test('all functions use provided.al2023 runtime on ARM64', () => {
    const functions = template.findResources('AWS::Lambda::Function');
    for (const fn of Object.values(functions)) {
      const props = (fn as any).Properties;
      expect(props.Runtime).toBe('provided.al2023');
      expect(props.Architectures).toContain('arm64');
    }
  });

  test('submit-suggestion function has TABLE_NAME and SSM_PARAM env vars', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'pe-blocker-submit-suggestion',
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          SSM_PARAM: Match.anyValue(),
        }),
      },
    });
  });

  test('budget-enforcer function has SSM_PARAM env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'pe-blocker-budget-enforcer',
      Environment: {
        Variables: Match.objectLike({ SSM_PARAM: Match.anyValue() }),
      },
    });
  });

  test('budget-resetter function has SSM_PARAM env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'pe-blocker-budget-resetter',
      Environment: {
        Variables: Match.objectLike({ SSM_PARAM: Match.anyValue() }),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// API Gateway
// ---------------------------------------------------------------------------

describe('API Gateway', () => {
  test('creates a REST API named pe-blocker-api', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'pe-blocker-api',
    });
  });

  test('deploys a "prod" stage', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'prod',
    });
  });
});

// ---------------------------------------------------------------------------
// WAF
// ---------------------------------------------------------------------------

describe('WAF WebACL', () => {
  test('creates a CLOUDFRONT-scoped WebACL', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Name: 'pe-blocker-waf',
      Scope: 'CLOUDFRONT',
    });
  });

  test('includes a rate-based rule', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'RateLimit',
          Statement: Match.objectLike({
            RateBasedStatement: Match.objectLike({ Limit: 100 }),
          }),
        }),
      ]),
    });
  });

  test('includes the AWS managed common rule set', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'AWSManagedRulesCommonRuleSet',
          Statement: Match.objectLike({
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesCommonRuleSet',
            },
          }),
        }),
      ]),
    });
  });
});

// ---------------------------------------------------------------------------
// CloudFront
// ---------------------------------------------------------------------------

describe('CloudFront', () => {
  test('creates a CloudFront distribution', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  test('distribution enforces HTTPS only', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'https-only',
        }),
      }),
    });
  });
});

// ---------------------------------------------------------------------------
// SNS
// ---------------------------------------------------------------------------

describe('SNS', () => {
  test('creates the budget alert topic', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'pe-blocker-budget-alerts',
    });
  });

  test('topic has a subscription to the budget-enforcer Lambda', () => {
    template.resourceCountIs('AWS::SNS::Subscription', 1);
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'lambda',
    });
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe('AWS Budget', () => {
  test('creates a monthly cost budget named pe-blocker-monthly', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetName: 'pe-blocker-monthly',
        BudgetType: 'COST',
        TimeUnit: 'MONTHLY',
        BudgetLimit: { Amount: 20, Unit: 'USD' },
      }),
    });
  });

  test('budget fires at 100% of the limit (actual spend)', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Notification: Match.objectLike({
            NotificationType: 'ACTUAL',
            ComparisonOperator: 'GREATER_THAN',
            Threshold: 100,
          }),
        }),
      ]),
    });
  });
});

// ---------------------------------------------------------------------------
// EventBridge Scheduler
// ---------------------------------------------------------------------------

describe('EventBridge Scheduler', () => {
  test('creates a monthly reset schedule', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'pe-blocker-monthly-budget-reset',
      ScheduleExpression: 'cron(0 0 1 * ? *)',
    });
  });
});
