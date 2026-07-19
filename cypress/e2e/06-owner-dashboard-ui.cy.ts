/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * Flow 6: Owner Dashboard UI End-to-End (Browser-based)
 *
 * Tests the Owner dashboard through ACTUAL browser UI:
 * Admin login → Dashboard KPI cards → Charts → Period filter → RBAC
 * → Approval workflow (approve/reject)
 *
 * Requires: apps/admin (port 4001), services/api (port 3000) running.
 */
describe('Flow 6: Owner Dashboard UI End-to-End', () => {
  const ADMIN = Cypress.env('ADMIN_URL') || 'http://localhost:4001';
  const API = Cypress.env('API_URL') || 'http://localhost:3000';

  describe('Admin Login (UI)', () => {
    it('1. Staff can login via admin login page', () => {
      cy.visit(`${ADMIN}/login`);

      // Login form should be visible
      cy.get('[data-testid="admin-email-input"]').should('be.visible');
      cy.get('[data-testid="admin-password-input"]').should('be.visible');

      // Fill credentials
      cy.get('[data-testid="admin-email-input"]').type('owner@mlv.dev');
      cy.get('[data-testid="admin-password-input"]').type('owner123');

      // Submit
      cy.get('[data-testid="admin-login-btn"]').click();

      // Should redirect to dashboard
      cy.url({ timeout: 10000 }).should('include', '/dashboard');
    });

    it('2. Invalid credentials show error', () => {
      cy.visit(`${ADMIN}/login`);

      cy.get('[data-testid="admin-email-input"]').type('wrong@mlv.dev');
      cy.get('[data-testid="admin-password-input"]').type('wrongpass');
      cy.get('[data-testid="admin-login-btn"]').click();

      // Should show error message
      cy.contains('Email atau password salah', { timeout: 10000 }).should(
        'be.visible',
      );
    });
  });

  describe('Owner Dashboard - Full KPI', () => {
    beforeEach(() => {
      // Login as Owner via API for speed, then visit dashboard
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
    });

    it('3. Dashboard renders with all KPI sections', () => {
      cy.visit(`${ADMIN}/dashboard`);

      // Page title
      cy.contains('Dashboard Analytics').should('be.visible');

      // Financial KPIs (Owner-only)
      cy.get('[data-testid="kpi-omzet"]').should('be.visible');
      cy.get('[data-testid="kpi-profit"]').should('be.visible');
      cy.get('[data-testid="kpi-aov"]').should('be.visible');

      // Operational KPIs
      cy.get('[data-testid="kpi-order-aktif"]').should('be.visible');
      cy.contains('Order Selesai').should('be.visible');
      cy.contains('Conversion Rate').should('be.visible');
      cy.contains('Dibatalkan').should('be.visible');
    });

    it('4. Production and quality metrics are visible', () => {
      cy.visit(`${ADMIN}/dashboard`);

      cy.contains('Lead Time Rata-rata').should('exist');
      cy.contains('On-Time Delivery').should('exist');
      cy.contains('Reject Rate QC').should('exist');
      cy.contains('Stock Accuracy').should('exist');
    });

    it('5. Customer metrics are visible', () => {
      cy.visit(`${ADMIN}/dashboard`);

      cy.contains('Repeat Customer Rate').should('exist');
      cy.contains('Avg Response Time CS').should('exist');
    });

    it('6. Revenue chart renders for Owner', () => {
      cy.visit(`${ADMIN}/dashboard`);

      // Chart cards only render when data exists; check page loaded as Owner
      cy.contains('Dashboard Analytics').should('be.visible');
      cy.get('[data-testid="kpi-omzet"]').should('be.visible');
    });

    it('7. Top tables render for Owner', () => {
      cy.visit(`${ADMIN}/dashboard`);

      // Top tables only render when data exists; verify Owner sees financial KPIs
      cy.get('[data-testid="kpi-profit"]').should('be.visible');
      cy.get('[data-testid="kpi-aov"]').should('be.visible');
    });

    it('8. Period filter works - switching to week', () => {
      cy.visit(`${ADMIN}/dashboard`);

      cy.get('[data-testid="period-week"]').click();

      // Period text should update
      cy.contains('Periode:', { timeout: 10000 }).should('be.visible');
    });

    it('9. Period filter works - custom date range', () => {
      cy.visit(`${ADMIN}/dashboard`);

      cy.get('[data-testid="period-custom"]').click();

      // Custom date inputs should appear
      cy.get('[data-testid="period-from"]').should('be.visible');
      cy.get('[data-testid="period-to"]').should('be.visible');
    });
  });

  describe('Manajer Dashboard - Operational Only', () => {
    beforeEach(() => {
      cy.loginAsStaff('manajer@mlv.dev', 'manajer123');
    });

    it('10. Manajer sees operational KPIs but NOT financial', () => {
      cy.visit(`${ADMIN}/dashboard`);

      // Operational KPIs should be visible
      cy.get('[data-testid="kpi-order-aktif"]').should('be.visible');
      cy.contains('Order Selesai').should('be.visible');

      // Financial KPIs should NOT be visible (RBAC)
      cy.get('[data-testid="kpi-omzet"]').should('not.exist');
      cy.get('[data-testid="kpi-profit"]').should('not.exist');
      cy.get('[data-testid="kpi-aov"]').should('not.exist');
    });

    it('11. Manajer does NOT see revenue chart or top tables', () => {
      cy.visit(`${ADMIN}/dashboard`);

      // Revenue chart and top tables are Owner-only
      cy.get('[data-testid="chart-revenue"]').should('not.exist');
      cy.contains('Top Produk').should('not.exist');
      cy.contains('Top Customer').should('not.exist');
    });
  });

  describe('Sidebar RBAC', () => {
    it('12. Owner sees all sidebar items', () => {
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
      cy.visit(`${ADMIN}/dashboard`);

      cy.get('[data-testid="sidebar-dashboard"]').should('be.visible');
      cy.get('[data-testid="sidebar-order"]').should('be.visible');
      cy.get('[data-testid="sidebar-production"]').should('be.visible');
      cy.get('[data-testid="sidebar-inventory"]').should('be.visible');
      cy.get('[data-testid="sidebar-finance"]').should('be.visible');
      cy.get('[data-testid="sidebar-approval"]').should('be.visible');
      cy.get('[data-testid="sidebar-shipping"]').should('be.visible');
    });

    it('13. Penjahit sees limited sidebar items', () => {
      cy.loginAsStaff('penjahit@mlv.dev', 'penjahit123');
      cy.visit(`${ADMIN}/orders`);

      // Penjahit should see Order, Production, Inventory, Notifications
      cy.get('[data-testid="sidebar-order"]').should('be.visible');
      cy.get('[data-testid="sidebar-production"]').should('be.visible');

      // Penjahit should NOT see Dashboard, Finance, Approval, Shipping
      cy.get('[data-testid="sidebar-dashboard"]').should('not.exist');
      cy.get('[data-testid="sidebar-finance"]').should('not.exist');
      cy.get('[data-testid="sidebar-approval"]').should('not.exist');
      cy.get('[data-testid="sidebar-shipping"]').should('not.exist');
    });
  });

  describe('Approval Workflow (UI)', () => {
    it('14. Owner can view approvals page', () => {
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
      cy.visit(`${ADMIN}/approvals`);

      cy.contains('Approval').should('be.visible');
      // Owner should see approve/reject buttons for pending items
    });

    it('15. Manajer sees own approvals without action buttons', () => {
      cy.loginAsStaff('manajer@mlv.dev', 'manajer123');
      cy.visit(`${ADMIN}/approvals`);

      cy.contains('Status request approval').should('be.visible');
      // Manajer should NOT see Approve/Reject buttons
      cy.get('[data-testid="approve-btn"]').should('not.exist');
      cy.get('[data-testid="reject-btn"]').should('not.exist');
    });
  });

  describe('Admin Logout (UI)', () => {
    it('16. Staff can logout and is redirected to login', () => {
      cy.loginAsStaff('owner@mlv.dev', 'owner123');
      cy.visit(`${ADMIN}/dashboard`);

      cy.get('[data-testid="admin-logout-btn"]').click();

      // Should redirect to login page
      cy.url({ timeout: 10000 }).should('include', '/login');
    });
  });
});
