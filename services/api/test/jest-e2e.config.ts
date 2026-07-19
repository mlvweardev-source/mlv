import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  maxWorkers: 1,
  testTimeout: 30000,
  collectCoverageFrom: [
    '../src/**/*.ts',
    '!../src/main.ts',
    '!../src/**/*.module.ts',
    '!../src/**/*.dto.ts',
    '!../src/**/*.controller.ts',
  ],
  coverageDirectory: '../coverage/e2e',
};

export default config;
