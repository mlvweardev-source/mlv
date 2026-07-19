/* eslint-disable @typescript-eslint/no-unused-expressions */

const API_URL = Cypress.env('API_URL') || 'http://localhost:3000';

/**
 * Login as staff via API and set auth cookies.
 */
Cypress.Commands.add('loginAsStaff', (email: string, password: string) => {
  cy.request({
    method: 'POST',
    url: `${API_URL}/auth/login`,
    body: { email, password },
    failOnStatusCode: true,
  }).then((response) => {
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
  });
});

/**
 * Login as customer by generating token via Cypress task.
 */
Cypress.Commands.add('loginAsCustomer', (customerId: string) => {
  cy.task<string>('getCustomerToken', customerId).then((token) => {
    cy.setCookie('mlv_customer_token', token, {
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
    });
  });
});

export {};
