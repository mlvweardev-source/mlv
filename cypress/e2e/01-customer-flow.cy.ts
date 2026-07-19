/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * Flow 1: Customer End-to-End
 * Login → Order → Checkout → Chat
 *
 * Tests the complete customer journey through the system.
 * Uses API directly (cy.request) for reliability — UI interaction
 * tests require running frontend which is tested in Flow 4.
 */
describe('Flow 1: Customer End-to-End', () => {
  const API = Cypress.env('API_URL');
  const CUSTOMER_ID = 'f2df1936-d819-46fd-8658-96b9dff7b7ce'; // Budi Pelanggan
  let customerToken: string;
  let orderId: string;

  before(() => {
    cy.task<string>('getCustomerToken', CUSTOMER_ID).then((t) => {
      customerToken = t;
    });
  });

  it('1. Customer can create order', () => {
    cy.request({
      method: 'POST',
      url: `${API}/orders`,
      headers: { Authorization: `Bearer ${customerToken}` },
      body: { customerId: CUSTOMER_ID },
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body.status).to.eq('DRAFT');
      expect(res.body.orderNumber).to.match(/^MLV-/);
      orderId = res.body.id;
    });
  });

  it('2. Customer can add items to order', () => {
    cy.request({
      method: 'POST',
      url: `${API}/orders/${orderId}/items`,
      headers: { Authorization: `Bearer ${customerToken}` },
      body: {
        productType: 'Kaos',
        basePriceSnapshot: 85000,
        sizes: [
          { ukuran: 'M', qty: 1 },
        ],
      },
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body.productType).to.eq('Kaos');
    });
  });

  it('3. Customer can checkout order', () => {
    cy.request({
      method: 'PATCH',
      url: `${API}/orders/${orderId}/status`,
      headers: { Authorization: `Bearer ${customerToken}` },
      body: { status: 'MENUNGGU_PEMBAYARAN_DP' },
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.status).to.eq('MENUNGGU_PEMBAYARAN_DP');
    });
  });

  it('4. Customer can create DP payment', () => {
    cy.request({
      method: 'POST',
      url: `${API}/payments`,
      headers: { Authorization: `Bearer ${customerToken}` },
      body: { orderId, jenis: 'DP', metode: 'transfer' },
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body.payment.jenis).to.eq('DP');
      // Auto-calculated 50% DP
      expect(res.body.payment.jumlah).to.be.greaterThan(0);
    });
  });

  it('5. Customer can view own orders', () => {
    cy.request({
      method: 'GET',
      url: `${API}/orders`,
      headers: { Authorization: `Bearer ${customerToken}` },
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(Array.isArray(res.body)).to.be.true;
    });
  });

  it('6. Customer can check stock availability', () => {
    cy.request({
      method: 'GET',
      url: `${API}/orders/check-availability?productType=Kaos&qty=5`,
      headers: { Authorization: `Bearer ${customerToken}` },
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.available).to.be.true;
    });
  });

  it('7. Customer can send chat message', () => {
    cy.request({
      method: 'POST',
      url: `${API}/orders/${orderId}/customer-chat`,
      headers: { Authorization: `Bearer ${customerToken}` },
      body: { pesan: 'Kapan pesanan saya selesai?' },
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body.pesan).to.eq('Kapan pesanan saya selesai?');
      expect(res.body.senderType).to.eq('customer');
    });
  });

  it('8. Customer can get chat thread', () => {
    cy.request({
      method: 'GET',
      url: `${API}/orders/${orderId}/customer-chat`,
      headers: { Authorization: `Bearer ${customerToken}` },
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.messages).to.be.an('array');
      expect(res.body.messages.length).to.be.greaterThan(0);
    });
  });

  it('9. Customer can only see own orders', () => {
    cy.request({
      method: 'GET',
      url: `${API}/orders`,
      headers: { Authorization: `Bearer ${customerToken}` },
    }).then((res) => {
      expect(res.status).to.eq(200);
      // All returned orders should belong to this customer
      for (const order of res.body) {
        expect(order.customerId).to.eq(CUSTOMER_ID);
      }
    });
  });
});
