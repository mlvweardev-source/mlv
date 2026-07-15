import { Test, TestingModule } from '@nestjs/testing';
import { DispatcherService } from './dispatcher.service';
import {
  NOTIFICATION_CHANNELS,
  NotificationChannel,
} from '../channels/notification-channel.interface';
import { NotificationChannel as PrismaChannelEnum } from '@mlv/db';

const MockChannel = (name: string): NotificationChannel => ({
  channelName: name as PrismaChannelEnum,
  send: jest.fn().mockResolvedValue({ success: true, providerRef: 'test' }),
});

describe('DispatcherService', () => {
  let service: DispatcherService;
  let channels: NotificationChannel[];

  beforeEach(async () => {
    channels = [MockChannel('WHATSAPP'), MockChannel('DASHBOARD')];

    const module: TestingModule = await Test.createTestingModule({
      providers: [DispatcherService, { provide: NOTIFICATION_CHANNELS, useValue: channels }],
    }).compile();

    service = module.get<DispatcherService>(DispatcherService);
  });

  describe('renderTemplate', () => {
    it('should replace {{placeholder}} with payload value', () => {
      const result = service.renderTemplate('Halo {{customerNama}}, order {{orderNumber}}', {
        customerNama: 'Budi',
        orderNumber: 'MLV-001',
      });
      expect(result).toBe('Halo Budi, order MLV-001');
    });

    it('should format numbers with id-ID locale', () => {
      const result = service.renderTemplate('Total: Rp {{jumlah}}', {
        jumlah: 300000,
      });
      expect(result).toBe('Total: Rp 300.000');
    });

    it('should render multiple occurrences of same placeholder', () => {
      const result = service.renderTemplate('Order {{orderNumber}} → {{orderNumber}}', {
        orderNumber: 'X',
      });
      expect(result).toBe('Order X → X');
    });

    it('should return "-" for missing placeholder', () => {
      const result = service.renderTemplate('Hai {{nama}}', {});
      expect(result).toBe('Hai -');
    });
  });

  describe('dispatchEvent', () => {
    // Tests require DB — use integration test pattern (skip in unit-only run).
    // Real integration test lives in demo script.
    it.todo('dispatchEvent requires real Prisma (integration test in demo)');
  });
});
