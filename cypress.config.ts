import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    // No baseUrl — we use full URLs in cy.request() calls
    // The API server is started before Cypress runs
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    setupNodeEvents(on, config) {
      require('./cypress/support/plugins.js')(on, config);
      return config;
    },
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    video: false,
    screenshotOnRunFailure: true,
    env: {
      API_URL: 'http://localhost:3000',
      WEB_URL: 'http://localhost:4000',
      ADMIN_URL: 'http://localhost:4001',
    },
  },
});
