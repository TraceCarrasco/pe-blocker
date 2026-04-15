/**
 * Jest configuration for the pe-blocker infrastructure.
 *
 * Only the CDK stack assertions run here. Lambda handler tests are written
 * in Go and run with `go test ./...` inside each lambda directory.
 *
 * Run with: npm test
 */

export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/stack.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
