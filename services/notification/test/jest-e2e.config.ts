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
  moduleNameMapper: {
    '^@mlv/db$': '<rootDir>/../../../packages/db/src/index.ts',
    '^@mlv/auth$': '<rootDir>/../../../packages/auth/src/index.ts',
    '^@mlv/types$': '<rootDir>/../../../packages/types/src/index.ts',
  },
};

export default config;
