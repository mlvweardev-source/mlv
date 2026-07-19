// ***********************************************
// E2E Authentication Helper
// Uses cy.request() to call API directly for login,
// then sets httpOnly cookies for subsequent browser requests.
// ***********************************************

const API_URL = Cypress.env('API_URL') || 'http://localhost:3000';

/**
 * Login as staff via API and set auth cookies.
 * Works by calling POST /auth/login which sets httpOnly cookies.
 */
Cypress.Commands.add('loginAsStaff', (email: string, password: string) => {
  cy.request({
    method: 'POST',
    url: `${API_URL}/auth/login`,
    body: { email, password },
    failOnStatusCode: true,
  }).then((response) => {
    // Extract Set-Cookie headers and set them on the browser
    const cookies = response.headers['set-cookie'] as unknown as string[];
    if (cookies) {
      for (const cookie of cookies) {
        const [nameValue] = cookie.split(';');
        const [name, value] = nameValue.split('=');
        cy.setCookie(name.trim(), value.trim(), {
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
        });
      }
    }
    expect(response.status).to.eq(200);
    expect(response.body.user).to.exist;
  });
});

/**
 * Login as customer via API (OTP flow).
 * Since we can't receive real OTP via WhatsApp in tests,
 * we use the API's OTP verify endpoint with a known test code.
 *
 * For E2E testing, we set the cookie directly using the API's
 * auth endpoint which returns the token.
 */
Cypress.Commands.add('loginAsCustomer', (phone: string) => {
  // Request OTP (will go to mock/Fonnte in test)
  cy.request({
    method: 'POST',
    url: `${API_URL}/auth/otp/request`,
    body: { phone },
    failOnStatusCode: false, // OTP might fail if Fonnte not configured
  });

  // For E2E, we need a way to get the OTP code.
  // In CI, we can check the DB for the OTP hash or use a test-only endpoint.
  // For now, we'll use a workaround: set the cookie directly.
  // This is acceptable because the OTP verification logic is tested in integration tests.
  cy.task('getCustomerToken', phone).then((token: string) => {
    if (token) {
      cy.setCookie('mlv_customer_token', token, {
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
      });
    }
  });
});

/**
 * Visit a page with auth already set (prevents redirect to login).
 */
Cypress.Commands.add('visitAsStaff', (email: string, password: string, path: string) => {
  cy.loginAsStaff(email, password);
  cy.visit(path);
});

/**
 * Visit a page as customer.
 */
Cypress.Commands.add('visitAsCustomer', (phone: string, path: string) => {
  cy.loginAsCustomer(phone);
  cy.visit(path);
});

declare global {
  namespace Cypress {
    interface Chainable {
      loginAsStaff(email: string, password: string): Chainable<void>;
      loginAsCustomer(phone: string): Chainable<void>;
      visitAsStaff(email: string, password: string, path: string): Chainable<void>;
      visitAsCustomer(phone: string, path: string): Chainable<void>;
    }
  }
}

export {};
