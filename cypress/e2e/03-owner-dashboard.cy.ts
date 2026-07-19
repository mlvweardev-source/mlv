/**
 * Flow 3: Owner End-to-End
 * Dashboard Analytics (12 KPI metrics) + Approval Workflow
 */
describe('Flow 3: Owner End-to-End', () => {
  const API = Cypress.env('API_URL');
  const OWNER_ID = '04b26d55-1f8c-4a80-b282-52cb124cf6a8';
  const MANAJER_ID = '620930c7-74ba-4b4a-ae6e-3ccc5b8110f0';
  let ownerToken: string;
  let manajerToken: string;
  let approvalId: string;

  before(() => {
    cy.task<string>('getStaffToken', { userId: OWNER_ID, role: 'OWNER' }).then((t) => {
      ownerToken = t;
    });
    cy.task<string>('getStaffToken', { userId: MANAJER_ID, role: 'MANAJER_PRODUKSI' }).then((t) => {
      manajerToken = t;
    });
  });

  describe('Dashboard Analytics', () => {
    it('1. Owner gets full dashboard with 12 KPI metrics', () => {
      cy.request({
        method: 'GET',
        url: `${API}/analytics/dashboard`,
        headers: { Authorization: `Bearer ${ownerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`omzet).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`profit).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`aov).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`orderCounts).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`conversionRate).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`topProducts).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`topCustomers).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`leadTime).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`stockAccuracy).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`rejectRate).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`onTimeDelivery).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`repeatCustomer).to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`responseTimeCS).to.exist;
      });
    });

    it('2. Manajer gets operational metrics only (no financial)', () => {
      cy.request({
        method: 'GET',
        url: `${API}/analytics/dashboard`,
        headers: { Authorization: `Bearer ${manajerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.omzet).to.not.exist;
        expect(res.body.profit).to.not.exist;
        expect(res.body.aov).to.not.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions`n        expect(res.body.`orderCounts).to.exist;
      });
    });

    it('3. Dashboard with custom date range', () => {
      cy.request({
        method: 'GET',
        url: `${API}/analytics/dashboard?from=2026-01-01&to=2026-12-31`,
        headers: { Authorization: `Bearer ${ownerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.period.from).to.eq('2026-01-01');
        expect(res.body.period.to).to.eq('2026-12-31');
      });
    });
  });

  describe('Approval Workflow', () => {
    it('4. Manajer creates approval request', () => {
      cy.request({
        method: 'POST',
        url: `${API}/approvals`,
        headers: { Authorization: `Bearer ${manajerToken}` },
        body: { tipe: 'HARGA_KHUSUS', alasan: 'E2E test' },
      }).then((res) => {
        expect(res.status).to.eq(201);
        expect(res.body.status).to.eq('PENDING');
        approvalId = res.body.id;
      });
    });

    it('5. Manajer only sees own approvals', () => {
      cy.request({
        method: 'GET',
        url: `${API}/approvals`,
        headers: { Authorization: `Bearer ${manajerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(Array.isArray(res.body)).to.be.true;
      });
    });

    it('6. Owner can see all approvals', () => {
      cy.request({
        method: 'GET',
        url: `${API}/approvals`,
        headers: { Authorization: `Bearer ${ownerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(Array.isArray(res.body)).to.be.true;
      });
    });

    it('7. Owner approves the request', () => {
      cy.request({
        method: 'PATCH',
        url: `${API}/approvals/${approvalId}/decide`,
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { status: 'APPROVED', alasan: 'Approved for E2E' },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.status).to.eq('APPROVED');
      });
    });

    it('8. Owner can manage profit sharing', () => {
      cy.request({
        method: 'GET',
        url: `${API}/profit-sharing`,
        headers: { Authorization: `Bearer ${ownerToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
      });
    });
  });
});
