/* eslint-disable no-undef */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:3000';
const OWNER_TOKEN = __ENV.OWNER_TOKEN;
const MATERIAL_ID = __ENV.MATERIAL_ID;
const INITIAL_STOCK = parseInt(__ENV.INITIAL_STOCK || '100');

const reserveSuccess = new Counter('reserve_success');
const reserveFail = new Counter('reserve_fail');
const reserveDuration = new Trend('reserve_duration', true);

export const options = {
  scenarios: {
    stock_reservation: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 20 },
        { duration: '20s', target: 50 },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  const orderId = `k6-reserve-${__VU}-${__ITER}-${Date.now()}`;
  const payload = JSON.stringify({
    orderId,
    materialId: MATERIAL_ID,
    qty: 1,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OWNER_TOKEN}`,
    },
  };

  const start = Date.now();
  const res = http.post(`${API}/stock/reserve`, payload, params);
  reserveDuration.add(Date.now() - start);

  if (res.status === 201) {
    reserveSuccess.add(1);
  } else {
    reserveFail.add(1);
  }

  check(res, {
    'status is 201 or 400': (r) => r.status === 201 || r.status === 400,
  });

  sleep(0.05);
}
