// @mlv/types — Shared TypeScript types/DTO antar apps & services

export { ProductType } from './product-type';
export { QUEUES, ALL_QUEUES, EVENT_NAMES, EVENT_ROUTING, EVENT_JOB_OPTIONS } from './events';
export type { QueueName, EventName } from './events';
export type {
  CustomerContactFields,
  PaymentSucceededPayload,
  InvoiceIssuedPayload,
  ShipmentCreatedPayload,
  ProductionCompletedPayload,
  StockLowPayload,
  ApprovalRequestedPayload,
  ApprovalDecidedPayload,
} from './event-payloads';
