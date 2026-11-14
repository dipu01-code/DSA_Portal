/** jest-expo: React Native test environment. Root `npx jest` does not pick these up (.tsx under src/). */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  // The first render compiles React Native on a cold transform cache: ~3.5 s on a fast laptop, over the
  // default 5 s on CI runners. The tests themselves are quick; this only stops cold starts from failing.
  testTimeout: 20000,
  // ui-core is TypeScript source in the workspace; zustand ships ESM for some entry points.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|react-navigation|@react-navigation/.*|zustand|@dsa-portal/.*))',
  ],
};
