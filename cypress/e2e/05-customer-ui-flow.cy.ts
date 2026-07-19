/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * Flow 5: Customer UI End-to-End (Browser-based)
 *
 * Tests the complete customer journey through the ACTUAL browser UI:
 * OTP login → Order Builder → Checkout → Payment page
 *
 * This replaces the API-only Flow 1 with true browser interaction tests.
 * Requires: apps/web (port 4000), services/api (port 3000) running.
 */
describe('Flow 5: Customer UI End-to-End', () => {
  const WEB = Cypress.env('WEB_URL') || 'http://localhost:4000';
  const API = Cypress.env('API_URL') || 'http://localhost:3000';
  const CUSTOMER_PHONE = '08123456789';
  const CUSTOMER_ID = 'f2df1936-d819-46fd-8658-96b9dff7b7ce';
  const OTP_CODE = '999999';

  describe('OTP Login Flow (UI)', () => {
    it('1. Customer can request OTP via login page', () => {
      cy.visit(`${WEB}/login`);

      // Phone input step
      cy.get('[data-testid="customer-phone-input"]').should('be.visible');
      cy.get('[data-testid="customer-phone-input"]').type(CUSTOMER_PHONE);

      // Intercept OTP request API
      cy.intercept('POST', `${API}/auth/otp/request`).as('requestOtp');
      cy.get('[data-testid="request-otp-btn"]').click();
      cy.wait('@requestOtp').its('response.statusCode').should('be.oneOf', [200, 201]);

      // Should advance to OTP code step
      cy.get('[data-testid="customer-otp-input"]').should('be.visible');
      cy.contains('Kode OTP dikirim ke WhatsApp').should('be.visible');
    });

    it('2. Customer can verify OTP and login', () => {
      // Seed a known OTP code into the database
      cy.task('seedOtp', { phone: CUSTOMER_PHONE, code: OTP_CODE });

      cy.visit(`${WEB}/login`);
      cy.get('[data-testid="customer-phone-input"]').type(CUSTOMER_PHONE);

      cy.intercept('POST', `${API}/auth/otp/request`).as('requestOtp');
      cy.get('[data-testid="request-otp-btn"]').click();
      cy.wait('@requestOtp');

      // Enter known OTP code
      cy.get('[data-testid="customer-otp-input"]').type(OTP_CODE);

      cy.intercept('POST', `${API}/auth/otp/verify`).as('verifyOtp');
      cy.get('[data-testid="verify-otp-btn"]').click();
      cy.wait('@verifyOtp').its('response.statusCode').should('be.oneOf', [200, 201]);

      // Should redirect to home page after successful login
      cy.url().should('not.include', '/login');

      // Header should show user greeting
      cy.contains('Halo, Budi Pelanggan').should('be.visible');
      cy.get('[data-testid="customer-logout-btn"]').should('be.visible');
    });
  });

  describe('Order Builder Flow (UI)', () => {
    beforeEach(() => {
      // Login as customer via cookie (bypass OTP for subsequent tests)
      cy.loginAsCustomer(CUSTOMER_ID);
    });

    it('3. Customer can navigate to order builder', () => {
      cy.visit(`${WEB}/pesan`);

      // Order builder page should render
      cy.contains('Order Builder').should('be.visible');
      cy.contains('Pilih Produk').should('be.visible');

      // All 5 product types should be visible
      cy.get('[data-testid="product-kaos"]').should('be.visible');
      cy.get('[data-testid="product-kemeja"]').should('be.visible');
      cy.get('[data-testid="product-hoodie"]').should('be.visible');
      cy.get('[data-testid="product-topi"]').should('be.visible');
      cy.get('[data-testid="product-tas"]').should('be.visible');
    });

    it('4. Customer can select product and enter quantities', () => {
      cy.visit(`${WEB}/pesan`);

      // Select Kaos (should be default, but click to confirm)
      cy.get('[data-testid="product-kaos"]').click();
      cy.get('[data-testid="product-kaos"]').should(
        'have.class',
        'border-primary',
      );

      // Enter quantities for sizes (use small qty to avoid stock depletion by integration tests)
      cy.get('[data-testid="qty-m"]').clear().type('1');

      // Stock check should appear
      cy.contains('Bahan Baku Tersedia', { timeout: 15000 }).should(
        'be.visible',
      );

      // Summary should show correct totals
      cy.contains('Kaos (1 pcs)').should('be.visible');
    });

    it('5. Customer can fill notes and confirm order', () => {
      cy.visit(`${WEB}/pesan`);

      // Select product and quantities
      cy.get('[data-testid="product-kaos"]').click();
      cy.get('[data-testid="qty-m"]').clear().type('1');

      // Fill notes
      cy.get('[data-testid="order-notes"]')
        .type('Warna biru Navy, ukuran standar');

      // Check confirmation checkbox
      cy.get('[data-testid="confirm-design"]').check();

      // Checkout button should be enabled
      cy.get('[data-testid="checkout-btn"]').should('not.be.disabled');
    });

    it('6. Customer can checkout and reach payment page', () => {
      cy.visit(`${WEB}/pesan`);

      // Build order
      cy.get('[data-testid="product-kaos"]').click();
      cy.get('[data-testid="qty-m"]').clear().type('1');
      cy.get('[data-testid="confirm-design"]').check();

      // Wait for stock check
      cy.contains('Bahan Baku Tersedia', { timeout: 15000 }).should(
        'be.visible',
      );

      // Intercept checkout API calls
      cy.intercept('POST', `${API}/orders`).as('createOrder');
      cy.intercept('POST', `${API}/orders/*/items`).as('addItem');
      cy.intercept('PATCH', `${API}/orders/*/status`).as('checkout');
      cy.intercept('POST', `${API}/payments`).as('createPayment');

      // Click checkout
      cy.get('[data-testid="checkout-btn"]').click();

      // Wait for the checkout flow to complete
      cy.wait('@createOrder').its('response.statusCode').should('eq', 201);
      cy.wait('@addItem').its('response.statusCode').should('eq', 201);
      cy.wait('@checkout').its('response.statusCode').should('eq', 200);
      cy.wait('@createPayment').its('response.statusCode').should('eq', 201);

      // Should redirect to payment page
      cy.url({ timeout: 15000 }).should('include', '/pesan/bayar/');
      cy.contains('Menunggu Pembayaran DP').should('be.visible');
    });
  });

  describe('Order History (UI)', () => {
    beforeEach(() => {
      cy.loginAsCustomer(CUSTOMER_ID);
    });

    it('7. Customer can view order history', () => {
      cy.visit(`${WEB}/pesanan`);

      // Should show order list (protected page, redirected if not logged in)
      cy.url().should('include', '/pesanan');
    });

    it('8. Customer is redirected to login when not authenticated', () => {
      // Clear cookies to simulate logged-out state
      cy.clearCookie('mlv_customer_token');
      cy.visit(`${WEB}/pesanan`);

      // Should redirect to login
      cy.url({ timeout: 10000 }).should('include', '/login');
    });
  });

  describe('Header Navigation (UI)', () => {
    it('9. Header shows login button when not logged in', () => {
      cy.visit(`${WEB}/`);
      cy.get('[data-testid="customer-login-btn"]').should('be.visible');
    });

    it('10. Header shows user info when logged in', () => {
      cy.loginAsCustomer(CUSTOMER_ID);
      cy.visit(`${WEB}/`);

      cy.contains('Halo, Budi Pelanggan').should('be.visible');
      cy.get('[data-testid="customer-logout-btn"]').should('be.visible');
    });
  });
});
