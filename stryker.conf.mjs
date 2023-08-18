// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'yarn',
  reporters: ['html', 'clear-text', 'progress', 'dashboard'],
  testRunner: 'jest',
  coverageAnalysis: 'perTest',
  mutate: ['handlers/*.js'],
  thresholds: { high: 100, low: 75, 'break': null },
  cleanTempDir: 'always',
};
export default config;
