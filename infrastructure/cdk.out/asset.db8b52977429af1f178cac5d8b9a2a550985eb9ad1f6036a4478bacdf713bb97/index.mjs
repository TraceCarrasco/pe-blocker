// budget-resetter/index.mjs
// Triggered by EventBridge Scheduler on the 1st of each month (00:00 UTC).
// Sets the SSM submissions-enabled flag back to "true", restoring normal
// submission behavior for the new billing cycle.

import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({});

export const handler = async (event) => {
  console.log('Monthly budget reset — re-enabling submissions', JSON.stringify(event));

  await ssmClient.send(new PutParameterCommand({
    Name: process.env.SSM_PARAM,
    Value: 'true',
    Type: 'String',
    Overwrite: true,
  }));

  console.log(`Set ${process.env.SSM_PARAM} = "true"`);
};
