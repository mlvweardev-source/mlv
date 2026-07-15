import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES, EVENT_ROUTING, EVENT_JOB_OPTIONS } from '@mlv/types';
import type { EventName, QueueName } from '@mlv/types';

/**
 * Event Bus Service — Producer BullMQ (§7, §18)
 *
 * Pengganti EventEmitter2 (Fase 1-5). Semua event domain di-publish
 * lewat service ini dan dirutekan ke queue domain KONSUMEN sesuai
 * EVENT_ROUTING di @mlv/types (satu queue per domain konsumen, §4).
 *
 * Retry/DLQ: 3x exponential backoff; job gagal masuk state `failed`
 * bawaan BullMQ (berfungsi sebagai DLQ) — pantau via Bull Board (§22).
 */
@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUES.ORDER_EVENTS) orderQueue: Queue,
    @InjectQueue(QUEUES.INVENTORY_EVENTS) inventoryQueue: Queue,
    @InjectQueue(QUEUES.PRODUCTION_EVENTS) productionQueue: Queue,
    @InjectQueue(QUEUES.FINANCE_EVENTS) financeQueue: Queue,
    @InjectQueue(QUEUES.NOTIFICATION_EVENTS) notificationQueue: Queue,
  ) {
    this.queues = {
      [QUEUES.ORDER_EVENTS]: orderQueue,
      [QUEUES.INVENTORY_EVENTS]: inventoryQueue,
      [QUEUES.PRODUCTION_EVENTS]: productionQueue,
      [QUEUES.FINANCE_EVENTS]: financeQueue,
      [QUEUES.NOTIFICATION_EVENTS]: notificationQueue,
    };
  }

  /**
   * Publish event ke semua queue konsumen sesuai EVENT_ROUTING.
   * Job name = nama event, payload = data event (JSON-serialized).
   */
  async publish(eventName: EventName, payload: unknown): Promise<void> {
    const targets = EVENT_ROUTING[eventName];

    if (!targets || targets.length === 0) {
      this.logger.warn(`Event "${eventName}" tidak punya routing — di-skip`);
      return;
    }

    await Promise.all(
      targets.map((queueName) => this.queues[queueName].add(eventName, payload, EVENT_JOB_OPTIONS)),
    );

    this.logger.log(`Published ${eventName} → [${targets.join(', ')}]`);
  }
}
