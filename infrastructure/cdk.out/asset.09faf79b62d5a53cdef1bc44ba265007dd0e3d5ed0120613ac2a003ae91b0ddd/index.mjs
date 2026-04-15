// budget-enforcer/index.mjs
// Triggered by SNS when AWS Budgets reports actual spend > $20.
// Sets the SSM submissions-enabled flag to "false", which causes the
// submit-suggestion Lambda to silently drop new submissions for the
// remainder of the billing cycle.

import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({});

export const handler = async (event) => {
  console.log('Budget threshold exceeded — disabling submissions', JSON.stringify(event));

  await ssmClient.send(new PutParameterCommand({
    Name: process.env.SSM_PARAM,
    Value: 'false',
    Type: 'String',
    Overwrite: true,
  }));

  console.log(`Set ${process.env.SSM_PARAM} = "false"`);
};
