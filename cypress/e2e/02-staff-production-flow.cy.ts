/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * Flow 2: Staff Production End-to-End
 * Owner creates order → checkout → view tasks → view routing → finance → shipping → analytics
 */
describe('Flow 2: Staff Production End-to-End', () => {
  const API = Cypress.env('API_URL');
  const CUSTOMER_ID = 'f2df1936-d819-46fd-8658-96b9dff7b7ce';
  const OWNER_ID = '04b26d55-1f8c-4a80-b282-52cb124cf6a8';
  let ownerToken: string;
  let orderId: string;

  before(() => {
    cy.task<string>('getStaffToken', { userId: OWNER_ID, role: 'OWNER' }).then((t) => {
      ownerToken = t;
    });
  });

  it('1. Owner creates order with items and checks out', () => {
    // Create order
    cy.request({
      method: 'POST',
      url: `${API}/orders`,
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { customerId: CUSTOMER_ID },
    })
      .then((createRes) => {
        expect(createRes.status).to.eq(201);
        orderId = createRes.body.id;

        // Add item
        return cy.request({
          method: 'POST',
          url: `${API}/orders/${orderId}/items`,
          headers: { Authorization: `Bearer ${ownerToken}` },
          body: { productType: 'Kaos', basePriceSnapshot: 85000, sizes: [{ ukuran: 'M', qty: 1 }] },
        });
      })
      .then((itemRes) => {
        expect(itemRes.status).to.eq(201);

        // Checkout
        return cy.request({
          method: 'PATCH',
          url: `${API}/orders/${orderId}/status`,
          headers: { Authorization: `Bearer ${ownerToken}` },
          body: { status: 'MENUNGGU_PEMBAYARAN_DP' },
        });
      })
      .then((checkoutRes) => {
        expect(checkoutRes.status).to.eq(200);
        expect(checkoutRes.body.status).to.eq('MENUNGGU_PEMBAYARAN_DP');
      });
  });

  it('2. Owner views production tasks', () => {
    cy.request({
      method: 'GET',
      url: `${API}/production/tasks`,
      headers: { Authorization: `Bearer ${ownerToken}` },
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(Array.isArray(res.body)).to.be.true;
    });
  });

  it('3. Owner can view routing', () => {
    cy.request({
      method: 'GET',
      url: `${API}/production/routings/Kaos`,
      headers: { Authorization: `Bearer ${ownerToken}` },
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.productType).to.eq('Kaos');
    });
  });

  it('4. Owner can access finance endpoints', () => {
    cy.request({
      method: 'GET',
      url: `${API}/payments`,
      headers: { Authorization: `Bearer ${ownerToken}` },
    }).then((res) => {
      expect(res.status).to.eq(200);
    });

    cy.request({
      method: 'GET',
      url: `${API}/invoices`,
      headers: { Authorization: `Bearer ${ownerToken}` },
    }).then((res) => {
      expect(res.status).to.eq(200);
    });
  });

  it('5. Owner can view shipping list', () => {
    cy.request({
      method: 'GET',
      url: `${API}/shipments`,
      headers: { Authorization: `Bearer ${ownerToken}` },
    }).then((res) => {
      expect(res.status).to.eq(200);
    });
  });

  it('6. Owner can view analytics dashboard', () => {
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
