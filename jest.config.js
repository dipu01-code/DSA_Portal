/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testMatch: [
    '<rootDir>/core/__tests__/**/*.test.ts',
    '<rootDir>/web/__tests__/**/*.test.ts',
    '<rootDir>/desktop/__tests__/**/*.test.ts',
    '<rootDir>/mobile/__tests__/**/*.test.ts',
    '<rootDir>/server/__tests__/**/*.test.ts',
    '<rootDir>/workers/__tests__/**/*.test.ts',
  ],
  testEnvironment: 'node',
  // Test against core's source so server/workers tests never run a stale core/dist build.
  moduleNameMapper: {
    '^@dsa-portal/core$': '<rootDir>/core/src/index.ts',
    '^@dsa-portal/workers$': '<rootDir>/workers/src/index.ts',
    '^@dsa-portal/server/dist/(.*)$': '<rootDir>/server/src/$1',
  },
  passWithNoTests: true,
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  // Core's own engine. storage/ and sync/ (Person 2) have their own tests but are not part of the threshold.
  collectCoverageFrom: [
    '<rootDir>/core/src/**/*.ts',
    '!<rootDir>/core/src/storage/**',
    '!<rootDir>/core/src/sync/**',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
};
