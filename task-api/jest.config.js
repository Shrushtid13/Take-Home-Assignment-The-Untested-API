// Jest configuration.
module.exports = {
  // Node environment (no browser/DOM needed for an API).
  testEnvironment: 'node',
  // `npm run coverage` writes its HTML/lcov report here.
  coverageDirectory: 'coverage',
  // Measure coverage over all source files, even ones no test imports.
  collectCoverageFrom: ['src/**/*.js'],
  // Only files under tests/ ending in .test.js are treated as tests.
  testMatch: ['**/tests/**/*.test.js'],
};
