import { Injectable, Logger } from '@nestjs/common';
import type { JwtPayload } from '@mlv/auth';
import { FinanceService } from '../finance/services/finance.service';
import { OrderService } from '../order/services/order.service';
import { ProductionService } from '../production/services/production.service';
import { ShippingService } from '../shipping/services/shipping.service';
import { CustomerService } from '../customer/services/customer.service';
import { InventoryService } from '../inventory/services/inventory.service';
import { CustomerChatService } from '../../common/customer-chat/customer-chat.service';

export interface DashboardData {
  period: { from: string; to: string };
  // Financial (Owner-only)
  omzet?: { total: number; byMonth: Array<{ month: string; total: number }> };
  profit?: {
    total: number;
    revenue: number;
    materialCost: number;
    productionCost: number;
    note: string;
  };
  aov?: { value: number; orderCount: number; totalRevenue: number };
  // Operational (Owner + Manajer)
  orderCounts: { total: number; active: number; completed: number; cancelled: number };
  conversionRate: { draftCount: number; confirmedCount: number; rate: number };
  topProducts: Array<{ productType: string; qty: number; revenue: number }>;
  topCustomers: Array<{ customerId: string; nama: string; orderCount: number; totalSpent: number }>;
  leadTime: { averageHours: number | null; note: string };
  onTimeDelivery: { total: number; onTime: number; rate: number };
  rejectRate: { total: number; rejected: number; rate: number };
  stockAccuracy: { totalMovements: number; adjustments: number; accuracy: number; note: string };
  repeatCustomer: { totalActive: number; repeatCount: number; rate: number };
  responseTimeCS: { averageMinutes: number | null; note: string };
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly financeService: FinanceService,
    private readonly orderService: OrderService,
    private readonly productionService: ProductionService,
    private readonly shippingService: ShippingService,
    private readonly customerService: CustomerService,
    private readonly inventoryService: InventoryService,
    private readonly customerChatService: CustomerChatService,
  ) {}

  /**
   * Agregasi semua 12 metrik KPI untuk dashboard.
   * RBAC filtering: Manajer Produksi hanya dapat metrik operasional.
   *
   * TIDAK ADA akses Prisma langsung ke domain lain — semua lewat service method (DDD §4.1).
   */
  async getDashboard(actor: JwtPayload, fromStr?: string, toStr?: string): Promise<DashboardData> {
    // Default periode: awal bulan ini sampai hari ini
    const now = new Date();
    const from = fromStr
      ? new Date(fromStr + 'T00:00:00.000Z')
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = toStr ? new Date(toStr + 'T23:59:59.999Z') : now;

    // Kumpulkan semua data secara paralel (semua via service method, bukan Prisma langsung)
    const [
      revenueData,
      materialCosts,
      aovData,
      orderCounts,
      conversionRate,
      topProducts,
      topCustomers,
      averageLeadTime,
      onTimeDelivery,
      rejectRate,
      stockAccuracy,
      repeatCustomer,
      responseTimeCS,
      productionCostPerProduct,
    ] = await Promise.all([
      this.financeService.getRevenueByPeriod(from, to),
      this.financeService.getMaterialCostsByPeriod(from, to),
      this.financeService.getAverageOrderValue(from, to),
      this.orderService.getOrderCountsByPeriod(from, to),
      this.orderService.getConversionRate(from, to),
      this.orderService.getTopProducts(from, to),
      this.orderService.getTopCustomers(from, to),
      this.productionService.getAverageLeadTime(from, to),
      this.shippingService.getOnTimeDeliveryRate(from, to),
      this.productionService.getRejectRate(from, to),
      this.inventoryService.getStockAccuracy(from, to),
      this.customerService.getRepeatCustomerRate(from, to),
      this.customerChatService.getAverageResponseTime(from, to),
      this.productionService.getProductionCostPerProduct(),
    ]);

    // Hitung estimasi production cost dari top products × cost per product
    // PLACEHOLDER: biaya jahit per pcs adalah estimasi, bukan data final dari bisnis
    let productionCostEstimate = 0;
    for (const product of topProducts) {
      const costPerPcs = productionCostPerProduct[product.productType] ?? 0;
      productionCostEstimate += product.qty * costPerPcs;
    }

    const profitTotal = revenueData.total - materialCosts - productionCostEstimate;

    const period = {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };

    // Financial metrics — hanya untuk Owner
    const isOwner = actor.role === 'OWNER';

    const result: DashboardData = {
      period,
      orderCounts,
      conversionRate,
      topProducts,
      topCustomers,
      leadTime: {
        averageHours: averageLeadTime,
        note: 'Rata-rata durasi dari task pertama (startedAt) ke task terakhir (completedAt) per order, dalam jam.',
      },
      onTimeDelivery,
      rejectRate,
      stockAccuracy: {
        ...stockAccuracy,
        note: 'Formula: 1 - (COUNT(ADJUST movements) / COUNT(IN+OUT+ADJUST movements)). PLACEHOLDER — tidak ada physical stock count, akurasi diukur dari frekuensi koreksi manual.',
      },
      repeatCustomer,
      responseTimeCS: {
        averageMinutes: responseTimeCS,
        note: 'Rata-rata waktu dari pesan customer ke balasan pertama admin/ai_bot. AI bot DIHITUNG sebagai response karena Customer Support (Fase 12) adalah fitur aktif.',
      },
    };

    // Sisipkan financial metrics hanya untuk Owner
    if (isOwner) {
      result.omzet = revenueData;
      result.profit = {
        total: profitTotal,
        revenue: revenueData.total,
        materialCost: materialCosts,
        productionCost: productionCostEstimate,
        note: 'Profit = Omzet − Biaya Bahan (purchase_orders) − Estimasi Biaya Jahit. Biaya jahit PLACEHOLDER (estimasi per pcs dari production_routings).',
      };
      result.aov = {
        value: aovData.aov,
        orderCount: aovData.orderCount,
        totalRevenue: aovData.totalRevenue,
      };
    }

    return result;
  }
}
