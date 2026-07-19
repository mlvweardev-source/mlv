/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * Flow 7: Staff Production UI End-to-End (Browser-based)
 *
 * Tests the staff production flow through ACTUAL browser UI:
 * Owner creates order → Production kanban → Finance pages → Shipping
 *
 * Requires: apps/admin (port 4001), services/api (port 3000) running.
 */
describe('Flow 7: Staff Production UI End-to-End', () => {
  const ADMIN = Cypress.env('ADMIN_URL') || 'http://localhost:4001';
  const API = Cypress.env('API_URL') || 'http://localhost:3000';
  const CUSTOMER_ID = 'f2df1936-d819-46fd-8658-96b9dff7b7ce';

  describe('Production Kanban Board (UI)', () => {
    beforeEach(() => {
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
    });

    it('1. Owner sees production kanban board', () => {
      cy.visit(`${ADMIN}/production`);

      // Kanban board should render with column headers
      cy.contains('Production').should('exist');
      cy.contains('Cutting').should('exist');
      cy.contains('Sewing').should('exist');
      cy.contains('Finishing').should('exist');
      cy.contains('Packing').should('exist');
    });

    it('2. Kanban has show-done toggle and refresh', () => {
      cy.visit(`${ADMIN}/production`);

      cy.contains('Tampilkan yang selesai').should('be.visible');
      cy.contains('Muat Ulang').should('be.visible');
    });

    it('3. Penjahit sees task table instead of kanban', () => {
      cy.loginAsStaff('penjahit@mlv.dev', 'penjahit123');
      cy.visit(`${ADMIN}/production`);

      // Penjahit should see flat task table, not kanban
      cy.contains('Task Saya').should('be.visible');
    });
  });

  describe('Orders Management (UI)', () => {
    beforeEach(() => {
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
    });

    it('4. Owner can view orders list', () => {
      cy.visit(`${ADMIN}/orders`);

      cy.contains('Order').should('be.visible');
      cy.contains('Daftar semua pesanan').should('be.visible');

      // Search input should be visible
      cy.get('input[placeholder*="Cari nomor"]').should('exist');
    });

    it('5. Orders list has status filter', () => {
      cy.visit(`${ADMIN}/orders`);

      // Status filter dropdown should exist
      cy.get('select').should('exist');
    });
  });

  describe('Finance Pages (UI)', () => {
    beforeEach(() => {
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
    });

    it('6. Owner can view finance payments page', () => {
      cy.visit(`${ADMIN}/finance/payments`);

      // Finance page should render
      cy.url().should('include', '/finance');
    });

    it('7. Owner can view profit sharing page', () => {
      cy.visit(`${ADMIN}/finance/profit-sharing`);

      // Profit sharing is Owner-only
      cy.url().should('include', '/finance/profit-sharing');
    });

    it('8. Manajer CANNOT access profit sharing', () => {
      cy.loginAsStaff('manajer@mlv.dev', 'manajer123');
      cy.visit(`${ADMIN}/finance/profit-sharing`);

      // Should redirect to 403
      cy.url({ timeout: 10000 }).should('include', '/403');
    });
  });

  describe('Shipping Page (UI)', () => {
    beforeEach(() => {
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
    });

    it('9. Owner can view shipping page', () => {
      cy.visit(`${ADMIN}/shipping`);

      cy.contains('Shipping').should('be.visible');
    });
  });

  describe('Inventory Pages (UI)', () => {
    beforeEach(() => {
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
    });

    it('10. Owner can view stock page', () => {
      cy.visit(`${ADMIN}/inventory/stock`);

      // Should show stock balances
      cy.url().should('include', '/inventory/stock');
    });

    it('11. Owner can view materials page', () => {
      cy.visit(`${ADMIN}/inventory/materials`);

      cy.url().should('include', '/inventory/materials');
    });
  });

  describe('Notifications & Activity Log (UI)', () => {
    beforeEach(() => {
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
    });

    it('12. Owner can view notifications page', () => {
      cy.visit(`${ADMIN}/notifications`);

      cy.contains('Notifikasi').should('be.visible');
    });

    it('13. Owner can view activity log', () => {
      cy.visit(`${ADMIN}/activity-log`);

      cy.contains('Log aktivitas').should('exist');
    });
  });

  describe('403 Forbidden Page (UI)', () => {
    it('14. Unauthorized access shows 403 page', () => {
      cy.loginAsStaff('penjahit@mlv.dev', 'penjahit123');

      // Penjahit cannot access /dashboard
      cy.visit(`${ADMIN}/dashboard`);
      cy.url({ timeout: 10000 }).should('include', '/403');
      cy.contains('403').should('be.visible');
    });
  });
});
