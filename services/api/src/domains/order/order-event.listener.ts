import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '@mlv/db';
import { OrderService } from './services/order.service';
import { PaymentSucceededEvent } from '../finance/events/finance.events';

/**
 * Order Event Listeners
 *
 * Listen untuk events dari Finance dan Production domains.
 */
@Injectable()
export class OrderEventListener implements OnModuleInit {
  private readonly logger = new Logger(OrderEventListener.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly orderService: OrderService,
  ) {}

  onModuleInit() {
    // Listen to PaymentSucceeded → transition order status
    this.eventEmitter.on(PaymentSucceededEvent.eventName, async (event: PaymentSucceededEvent) => {
      this.logger.log(
        `Received PaymentSucceeded for order ${event.orderId}, jenis: ${event.jenis}`,
      );

      if (event.jenis === 'DP') {
        // DP berhasil → transition ke ANTREAN dan publish OrderConfirmed
        await this.handleDpPaymentSucceeded(event);
      } else if (event.jenis === 'PELUNASAN') {
        // Pelunasan berhasil → transition ke LUNAS
        await this.handlePelunasanPaymentSucceeded(event);
      }
    });

    this.logger.log('OrderEventListener registered');
  }

  private async handleDpPaymentSucceeded(event: PaymentSucceededEvent): Promise<void> {
    // Update order status ke ANTREAN
    const order = await prisma.order.findUnique({
      where: { id: event.orderId },
    });

    if (!order) {
      this.logger.warn(`Order not found: ${event.orderId}`);
      return;
    }

    if (order.status !== 'ANTREAN') {
      await prisma.order.update({
        where: { id: event.orderId },
        data: { status: 'ANTREAN' },
      });

      // Record timeline
      await prisma.orderTimelineEvent.create({
        data: {
          orderId: event.orderId,
          tipeEvent: 'ORDER_CONFIRMED',
          deskripsi: `Pembayaran DP Rp ${event.jumlah.toLocaleString()} berhasil. Order masuk antrean produksi.`,
        },
      });

      // Publish OrderConfirmed event - Production akan trigger task generation
      this.eventEmitter.emit('order.confirmed', {
        orderId: event.orderId,
        orderNumber: order.orderNumber,
        customerId: event.customerId,
      });

      this.logger.log(`Order ${order.orderNumber} transitioned to ANTREAN after DP payment`);
    }
  }

  private async handlePelunasanPaymentSucceeded(event: PaymentSucceededEvent): Promise<void> {
    // Update order status ke LUNAS
    await prisma.order.update({
      where: { id: event.orderId },
      data: { status: 'LUNAS' },
    });

    // Record timeline
    await prisma.orderTimelineEvent.create({
      data: {
        orderId: event.orderId,
        tipeEvent: 'PELUNASAN_BAYAR',
        deskripsi: `Pembayaran pelunasan Rp ${event.jumlah.toLocaleString()} berhasil.`,
      },
    });

    const order = await prisma.order.findUnique({ where: { id: event.orderId } });
    this.logger.log(`Order ${order?.orderNumber} transitioned to LUNAS after pelunasan payment`);
  }
}
