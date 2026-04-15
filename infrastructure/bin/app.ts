#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PeBlockerStack } from '../lib/stack';

const app = new cdk.App();

// WAF with CLOUDFRONT scope must be in us-east-1.
// All resources are co-located here for simplicity.
new PeBlockerStack(app, 'PeBlockerStack', {
  env: { region: 'us-east-1' },
  description: 'PE Blocker — channel suggestion API, WAF, CloudFront, budget guard',
});
