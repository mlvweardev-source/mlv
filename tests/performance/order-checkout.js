/* eslint-disable no-undef */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:3000';
const OWNER_TOKEN = __ENV.OWNER_TOKEN;
const CUSTOMER_ID = __ENV.CUSTOMER_ID;
const INITIAL_STOCK = parseInt(__ENV.INITIAL_STOCK || '100');

const checkoutSuccess = new Counter('checkout_success');
const checkoutFail = new Counter('checkout_fail');
const orderCreateDuration = new Trend('order_create_duration', true);
const addItemDuration = new Trend('add_item_duration', true);
const checkoutDuration = new Trend('checkout_duration', true);

export const options = {
  scenarios: {
    order_checkout: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 10 },
        { duration: '20s', target: 30 },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Lenient for CI shared runners (resource-limited). Tighten for dedicated perf env.
    http_req_duration: ['p(95)<5000', 'p(99)<10000'],
    http_req_failed: ['rate<0.3'],
  },
};

function headers() {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OWNER_TOKEN}`,
    },
  };
}

export default function () {
  // Step 1: Create order
  const createRes = http.post(
    `${API}/orders`,
    JSON.stringify({ customerId: CUSTOMER_ID }),
    headers(),
  );
  orderCreateDuration.add(createRes.timings.duration);

  if (createRes.status !== 201) {
    checkoutFail.add(1);
    return;
  }

  const orderId = createRes.json().id;

  // Step 2: Add item (1 Kaos, size M)
  const itemRes = http.post(
    `${API}/orders/${orderId}/items`,
    JSON.stringify({
      productType: 'Kaos',
      basePriceSnapshot: 85000,
      sizes: [{ ukuran: 'M', qty: 1 }],
    }),
    headers(),
  );
  addItemDuration.add(itemRes.timings.duration);

  if (itemRes.status !== 201) {
    checkoutFail.add(1);
    return;
  }

  // Step 3: Checkout (triggers stock reservation)
  const start = Date.now();
  const checkoutRes = http.patch(
    `${API}/orders/${orderId}/status`,
    JSON.stringify({ status: 'MENUNGGU_PEMBAYARAN_DP' }),
    headers(),
  );
  checkoutDuration.add(Date.now() - start);

  if (checkoutRes.status === 200) {
    checkoutSuccess.add(1);
  } else {
    checkoutFail.add(1);
  }

  check(checkoutRes, {
    'checkout status is 200 or 400': (r) => r.status === 200 || r.status === 400,
  });

  sleep(0.05);
}
