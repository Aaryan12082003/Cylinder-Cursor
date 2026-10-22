import { defineConfig, devices } from '@playwright/test'

const userData = '/tmp/cylinderflow-e2e'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:43123',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `rm -rf ${userData} && mkdir -p ${userData} && CYLINDERFLOW_NO_SANDBOX=1 CYLINDERFLOW_USER_DATA=${userData} xvfb-run -a npm run dev`,
    url: 'http://127.0.0.1:43123',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
