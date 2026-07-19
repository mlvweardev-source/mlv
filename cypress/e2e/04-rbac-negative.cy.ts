/**
 * Flow 4: RBAC Negative Test per Role
 * Login as each role, try to access unauthorized areas → verify blocked.
 */
describe('Flow 4: RBAC Negative Tests', () => {
  const API = Cypress.env('API_URL');
  let ownerToken: string;
  let manajerToken: string;
  let penjahitToken: string;
  let customerToken: string;

  before(() => {
    // Owner
    cy.request({
      method: 'POST',
      url: `${API}/auth/login`,
      body: { email: 'owner@mlv.dev', password: 'owner123' },
    }).then((r) => {
      const c = r.headers['set-cookie'] as unknown as string[];
      for (const s of c) {
        if (s.startsWith('mlv_access_token=')) ownerToken = s.split('=')[1].split(';')[0];
      }
    });

    // Manajer
    cy.request({
      method: 'POST',
      url: `${API}/auth/login`,
      body: { email: 'manajer@mlv.dev', password: 'manajer123' },
    }).then((r) => {
      const c = r.headers['set-cookie'] as unknown as string[];
      for (const s of c) {
        if (s.startsWith('mlv_access_token=')) manajerToken = s.split('=')[1].split(';')[0];
      }
    });

    // Penjahit
    cy.request({
      method: 'POST',
      url: `${API}/auth/login`,
      body: { email: 'penjahit@mlv.dev', password: 'penjahit123' },
    }).then((r) => {
      const c = r.headers['set-cookie'] as unknown as string[];
      for (const s of c) {
        if (s.startsWith('mlv_access_token=')) penjahitToken = s.split('=')[1].split(';')[0];
      }
    });

    // Customer (via task-generated token)
    cy.task<string>('getCustomerToken', 'f2df1936-d819-46fd-8658-96b9dff7b7ce').then((t) => {
      customerToken = t;
    });
  });

  // ==========================================
  // Penjahit RBAC
  // ==========================================
  describe('Penjahit restrictions', () => {
    it('Penjahit CANNOT access profit-sharing', () => {
      cy.request({
        method: 'GET',
        url: `${API}/profit-sharing`,
        headers: { Authorization: `Bearer ${penjahitToken}` },
        failOnStatusCode: false,
      }).then((res) => {
        expect([401, 403]).to.include(res.status);
      });
    });

    it('Penjahit CANNOT access invoices', () => {
      cy.request({
        method: 'GET',
        url: `${API}/invoices`,
        headers: { Authorization: `Bearer ${penjahitToken}` },
        failOnStatusCode: false,
      }).then((res) => {
        expect([401, 403]).to.include(res.status);
      });
    });

    it('Penjahit CAN access own tasks', () => {
      cy.request({
        method: 'GET',
        url: `${API}/production/tasks`,
        headers: { Authorization: `Bearer ${penjahitToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
      });
    });

    it('Penjahit CAN access materials list', () => {
      cy.request({
        method: 'GET',
        url: `${API}/materials`,
        headers: { Authorization: `Bearer ${penjahitToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
      });
    });
  });

  // ==========================================
  // Manajer RBAC
  // ==========================================
  describe('Manajer restrictions', () => {
    it('Manajer CANNOT access profit-sharing', () => {
      cy.request({
        method: 'GET',
        url: `${API}/profit-sharing`,
        headers: { Authorization: `Bearer ${manajerToken}` },
        failOnStatusCode: false,
      }).then((res) => {
        expect([401, 403]).to.include(res.status);
      });
    });

    it('Manajer CAN access payments', () => {
      cy.request({
        method: 'GET',
        url: `${API}/payments`,
        headers: { Authorization: `Bearer ${manajerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
      });
    });

    it('Manajer CAN create approval', () => {
      cy.request({
        method: 'POST',
        url: `${API}/approvals`,
        headers: { Authorization: `Bearer ${manajerToken}` },
        body: { tipe: 'DISKON', alasan: 'RBAC test' },
      }).then((res) => {
        expect(res.status).to.eq(201);
      });
    });

    it('Manajer CANNOT decide approval (Owner-only)', () => {
      // First create an approval
      cy.request({
        method: 'POST',
        url: `${API}/approvals`,
        headers: { Authorization: `Bearer ${manajerToken}` },
        body: { tipe: 'DISKON', alasan: 'RBAC test decide' },
      }).then((createRes) => {
        // Try to decide it as Manajer
        cy.request({
          method: 'PATCH',
          url: `${API}/approvals/${createRes.body.id}/decide`,
          headers: { Authorization: `Bearer ${manajerToken}` },
          body: { status: 'APPROVED' },
          failOnStatusCode: false,
        }).then((res) => {
          expect([401, 403]).to.include(res.status);
        });
      });
    });

    it('Manajer gets filtered approvals (own only)', () => {
      cy.request({
        method: 'GET',
        url: `${API}/approvals`,
        headers: { Authorization: `Bearer ${manajerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
        // Manajer should only see own approvals (filtering is done server-side)
        // We can't check specific ID here since it comes from the seed data
        expect(Array.isArray(res.body)).to.be.true;
      });
    });
  });

  // ==========================================
  // Customer RBAC
  // ==========================================
  describe('Customer restrictions', () => {
    it('Customer CANNOT access staff-only endpoints', () => {
      cy.request({
        method: 'GET',
        url: `${API}/materials`,
        headers: { Authorization: `Bearer ${customerToken}` },
        failOnStatusCode: false,
      }).then((res) => {
        expect([401, 403]).to.include(res.status);
      });
    });

    it('Customer CANNOT access invoices without orderId', () => {
      cy.request({
        method: 'GET',
        url: `${API}/invoices`,
        headers: { Authorization: `Bearer ${customerToken}` },
        failOnStatusCode: false,
      }).then((res) => {
        expect([400, 401, 403]).to.include(res.status);
      });
    });

    it('Customer CAN access own orders', () => {
      cy.request({
        method: 'GET',
        url: `${API}/orders`,
        headers: { Authorization: `Bearer ${customerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
      });
    });
  });

  // ==========================================
  // Owner — full access
  // ==========================================
  describe('Owner full access', () => {
    it('Owner CAN access profit-sharing', () => {
      cy.request({
        method: 'GET',
        url: `${API}/profit-sharing`,
        headers: { Authorization: `Bearer ${ownerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
      });
    });

    it('Owner CAN access activity log', () => {
      cy.request({
        method: 'GET',
        url: `${API}/activity-log`,
        headers: { Authorization: `Bearer ${ownerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
      });
    });

    it('Owner CAN access analytics dashboard', () => {
      cy.request({
        method: 'GET',
        url: `${API}/analytics/dashboard`,
        headers: { Authorization: `Bearer ${ownerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.omzet).to.exist;
      });
    });
  });
});
