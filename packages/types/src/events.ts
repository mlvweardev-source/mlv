// ==============================================
// Event-Driven Integration Layer — Kontrak Event (§7)
// Single source of truth untuk:
//   - Nama queue BullMQ (satu queue per domain KONSUMEN, §4)
//   - Nama event (job name = nama event)
//   - Routing: event → queue konsumen mana saja
//
// Dipakai oleh services/api (producer + consumer) dan
// services/notification (consumer lintas proses).
// ==============================================

/**
 * Satu queue per domain KONSUMEN (bukan per event type).
 * Selaras dengan kolom "Event Dikonsumsi" di §4 PRD.
 */
export const QUEUES = {
  ORDER_EVENTS: 'order-events',
  INVENTORY_EVENTS: 'inventory-events',
  PRODUCTION_EVENTS: 'production-events',
  FINANCE_EVENTS: 'finance-events',
  NOTIFICATION_EVENTS: 'notification-events',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);

/**
 * Katalog nama event (§7.1). Job name di BullMQ = nama event.
 */
export const EVENT_NAMES = {
  // Customer Domain
  CustomerRegistered: 'customer.registered',
  CustomerProfileUpdated: 'customer.profile.updated',

  // Order Domain
  OrderCreated: 'order.created',
  OrderConfirmed: 'order.confirmed',
  OrderCancelled: 'order.cancelled',
  OrderStatusChanged: 'order.status.changed',

  // Inventory Domain
  StockReserved: 'stock.reserved',
  StockReservationReleased: 'stock.reservation.released',
  StockReservationFailed: 'stock.reservation.failed', // konsumen: Order (§4) — belum ada publisher (wajar untuk Fase 6)
  StockDeducted: 'stock.deducted',
  StockLow: 'stock.low',

  // Production Domain
  TaskStarted: 'production.task.started',
  TaskCompleted: 'production.task.completed',
  ProductionCompleted: 'production.completed',

  // Finance Domain
  PaymentSucceeded: 'payment.succeeded',
  PaymentFailed: 'payment.failed',
  PaymentExpired: 'payment.expired',
  InvoiceIssued: 'invoice.issued',
  ApprovalRequested: 'approval.requested',
  ApprovalDecided: 'approval.decided',
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

/**
 * Routing event → queue konsumen (§4 kolom "Event Dikonsumsi").
 *
 * Catatan:
 * - Notification Domain adalah subscriber umum (§4) — SEMUA event
 *   dirutekan ke `notification-events`.
 * - `StockReservationFailed` (konsumen: Order) belum punya publisher —
 *   wajar untuk fase ini, ditangani saat publisher-nya dibangun.
 * - PaymentSucceeded → Order (bukan langsung ke Production/Inventory):
 *   Order-lah yang menerbitkan OrderConfirmed setelah transisi status,
 *   lalu Production & Inventory mengonsumsi OrderConfirmed (cascade §7.2).
 */
export const EVENT_ROUTING: Record<EventName, QueueName[]> = {
  // Customer
  [EVENT_NAMES.CustomerRegistered]: [QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.CustomerProfileUpdated]: [QUEUES.NOTIFICATION_EVENTS],

  // Order
  [EVENT_NAMES.OrderCreated]: [QUEUES.FINANCE_EVENTS, QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.OrderConfirmed]: [
    QUEUES.INVENTORY_EVENTS,
    QUEUES.PRODUCTION_EVENTS,
    QUEUES.NOTIFICATION_EVENTS,
  ],
  [EVENT_NAMES.OrderCancelled]: [QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.OrderStatusChanged]: [QUEUES.NOTIFICATION_EVENTS],

  // Inventory
  [EVENT_NAMES.StockReserved]: [QUEUES.PRODUCTION_EVENTS, QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.StockReservationReleased]: [QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.StockReservationFailed]: [QUEUES.ORDER_EVENTS, QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.StockDeducted]: [QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.StockLow]: [QUEUES.NOTIFICATION_EVENTS],

  // Production
  [EVENT_NAMES.TaskStarted]: [QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.TaskCompleted]: [QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.ProductionCompleted]: [
    QUEUES.ORDER_EVENTS,
    QUEUES.FINANCE_EVENTS,
    QUEUES.NOTIFICATION_EVENTS,
  ],

  // Finance
  [EVENT_NAMES.PaymentSucceeded]: [QUEUES.ORDER_EVENTS, QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.PaymentFailed]: [QUEUES.INVENTORY_EVENTS, QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.PaymentExpired]: [QUEUES.INVENTORY_EVENTS, QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.InvoiceIssued]: [QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.ApprovalRequested]: [QUEUES.NOTIFICATION_EVENTS],
  [EVENT_NAMES.ApprovalDecided]: [QUEUES.NOTIFICATION_EVENTS],
};

/**
 * Opsi default job BullMQ untuk semua event:
 * retry 3x exponential backoff, job gagal tetap tersimpan di state
 * `failed` bawaan BullMQ (berfungsi sebagai DLQ, dipantau via Bull Board).
 */
export const EVENT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000, // 1s → 2s → 4s
  },
  removeOnComplete: {
    age: 24 * 3600, // simpan job sukses max 24 jam
    count: 1000,
  },
  removeOnFail: false, // failed = DLQ, jangan dihapus
} as const;
