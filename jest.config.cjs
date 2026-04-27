export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.ts$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { 
      useESM: true,
      tsconfig: {
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
      }
    }]
  },
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  moduleFileExtension: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};