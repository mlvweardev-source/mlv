import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  const mockFinanceService = {
    getRevenueByPeriod: jest.fn(),
    getMaterialCostsByPeriod: jest.fn(),
    getAverageOrderValue: jest.fn(),
  };
  const mockOrderService = {
    getOrderCountsByPeriod: jest.fn(),
    getConversionRate: jest.fn(),
    getTopProducts: jest.fn(),
    getTopCustomers: jest.fn(),
  };
  const mockProductionService = {
    getAverageLeadTime: jest.fn(),
    getRejectRate: jest.fn(),
    getProductionCostPerProduct: jest.fn(),
  };
  const mockShippingService = {
    getOnTimeDeliveryRate: jest.fn(),
  };
  const mockCustomerService = {
    getRepeatCustomerRate: jest.fn(),
  };
  const mockInventoryService = {
    getStockAccuracy: jest.fn(),
  };
  const mockCustomerChatService = {
    getAverageResponseTime: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsService(
      mockFinanceService as any,
      mockOrderService as any,
      mockProductionService as any,
      mockShippingService as any,
      mockCustomerService as any,
      mockInventoryService as any,
      mockCustomerChatService as any,
    );
  });

  function setupDefaultMocks() {
    mockFinanceService.getRevenueByPeriod.mockResolvedValue({
      total: 5000000,
      byMonth: [{ month: '2026-07', total: 5000000 }],
    });
    mockFinanceService.getMaterialCostsByPeriod.mockResolvedValue(1000000);
    mockFinanceService.getAverageOrderValue.mockResolvedValue({
      aov: 2500000,
      orderCount: 2,
      totalRevenue: 5000000,
    });
    mockOrderService.getOrderCountsByPeriod.mockResolvedValue({
      total: 10,
      active: 3,
      completed: 5,
      cancelled: 2,
    });
    mockOrderService.getConversionRate.mockResolvedValue({
      draftCount: 4,
      confirmedCount: 6,
      rate: 0.6,
    });
    mockOrderService.getTopProducts.mockResolvedValue([
      { productType: 'Kaos', qty: 100, revenue: 3000000 },
    ]);
    mockOrderService.getTopCustomers.mockResolvedValue([
      { customerId: 'c1', nama: 'Customer 1', orderCount: 3, totalSpent: 1500000 },
    ]);
    mockProductionService.getAverageLeadTime.mockResolvedValue(48.5);
    mockProductionService.getRejectRate.mockResolvedValue({
      total: 20,
      rejected: 1,
      rate: 0.05,
    });
    mockProductionService.getProductionCostPerProduct.mockResolvedValue({
      Kaos: 5000,
      Kemeja: 8000,
    });
    mockShippingService.getOnTimeDeliveryRate.mockResolvedValue({
      total: 5,
      onTime: 4,
      rate: 0.8,
    });
    mockInventoryService.getStockAccuracy.mockResolvedValue({
      totalMovements: 100,
      adjustments: 5,
      accuracy: 0.95,
    });
    mockCustomerService.getRepeatCustomerRate.mockResolvedValue({
      totalActive: 10,
      repeatCount: 3,
      rate: 0.3,
    });
    mockCustomerChatService.getAverageResponseTime.mockResolvedValue(15.5);
  }

  describe('getDashboard', () => {
    it('should return operational metrics for non-Owner (Manajer)', async () => {
      setupDefaultMocks();
      const actor = { sub: 'mgr-1', role: 'MANAJER_PRODUKSI' } as any;

      const result = await service.getDashboard(actor);

      expect(result.orderCounts.total).toBe(10);
      expect(result.conversionRate.rate).toBe(0.6);
      expect(result.topProducts).toHaveLength(1);
      expect(result.topCustomers).toHaveLength(1);
      expect(result.leadTime.averageHours).toBe(48.5);
      expect(result.onTimeDelivery.rate).toBe(0.8);
      expect(result.rejectRate.rate).toBe(0.05);
      expect(result.stockAccuracy.accuracy).toBe(0.95);
      expect(result.repeatCustomer.rate).toBe(0.3);
      expect(result.responseTimeCS.averageMinutes).toBe(15.5);

      // Financial metrics should NOT be present for non-Owner
      expect(result.omzet).toBeUndefined();
      expect(result.profit).toBeUndefined();
      expect(result.aov).toBeUndefined();
    });

    it('should include financial metrics for Owner', async () => {
      setupDefaultMocks();
      const actor = { sub: 'owner-1', role: 'OWNER' } as any;

      const result = await service.getDashboard(actor);

      expect(result.omzet).toBeDefined();
      expect(result.omzet!.total).toBe(5000000);
      expect(result.omzet!.byMonth).toHaveLength(1);

      expect(result.profit).toBeDefined();
      // profit = revenue (5000000) - materialCost (1000000) - productionCost (100*5000 = 500000)
      expect(result.profit!.total).toBe(3500000);
      expect(result.profit!.revenue).toBe(5000000);
      expect(result.profit!.materialCost).toBe(1000000);
      expect(result.profit!.productionCost).toBe(500000);

      expect(result.aov).toBeDefined();
      expect(result.aov!.value).toBe(2500000);
      expect(result.aov!.orderCount).toBe(2);
    });

    it('should use custom date range when provided', async () => {
      setupDefaultMocks();
      const actor = { sub: 'owner-1', role: 'OWNER' } as any;

      const result = await service.getDashboard(actor, '2026-06-01', '2026-06-30');

      expect(result.period.from).toBe('2026-06-01');
      expect(result.period.to).toBe('2026-06-30');
    });

    it('should use default period (start of month) when no dates provided', async () => {
      setupDefaultMocks();
      const actor = { sub: 'owner-1', role: 'OWNER' } as any;
      const now = new Date();

      const result = await service.getDashboard(actor);

      const expectedFrom = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      expect(result.period.from).toBe(expectedFrom);
    });

    it('should calculate production cost from top products × cost per product', async () => {
      setupDefaultMocks();
      mockOrderService.getTopProducts.mockResolvedValue([
        { productType: 'Kaos', qty: 50, revenue: 2500000 },
        { productType: 'Kemeja', qty: 30, revenue: 1800000 },
      ]);
      mockProductionService.getProductionCostPerProduct.mockResolvedValue({
        Kaos: 5000,
        Kemeja: 8000,
      });
      mockFinanceService.getRevenueByPeriod.mockResolvedValue({ total: 4300000, byMonth: [] });
      mockFinanceService.getMaterialCostsByPeriod.mockResolvedValue(800000);
      const actor = { sub: 'owner-1', role: 'OWNER' } as any;

      const result = await service.getDashboard(actor);

      // productionCost = 50*5000 + 30*8000 = 250000 + 240000 = 490000
      expect(result.profit!.productionCost).toBe(490000);
      // profit = 4300000 - 800000 - 490000 = 3010000
      expect(result.profit!.total).toBe(3010000);
    });

    it('should handle missing production cost for product type (default 0)', async () => {
      setupDefaultMocks();
      mockOrderService.getTopProducts.mockResolvedValue([
        { productType: 'NewProduct', qty: 10, revenue: 500000 },
      ]);
      mockProductionService.getProductionCostPerProduct.mockResolvedValue({});
      mockFinanceService.getRevenueByPeriod.mockResolvedValue({ total: 500000, byMonth: [] });
      mockFinanceService.getMaterialCostsByPeriod.mockResolvedValue(100000);
      const actor = { sub: 'owner-1', role: 'OWNER' } as any;

      const result = await service.getDashboard(actor);

      // productionCost = 10 * 0 (unknown product) = 0
      expect(result.profit!.productionCost).toBe(0);
      expect(result.profit!.total).toBe(400000);
    });

    it('should include all note fields in response', async () => {
      setupDefaultMocks();
      const actor = { sub: 'mgr-1', role: 'MANAJER_PRODUKSI' } as any;

      const result = await service.getDashboard(actor);

      expect(result.leadTime.note).toContain('task pertama');
      expect(result.stockAccuracy.note).toContain('PLACEHOLDER');
      expect(result.responseTimeCS.note).toContain('AI bot DIHITUNG');
    });

    it('should call all 7 dependent services in parallel', async () => {
      setupDefaultMocks();
      const actor = { sub: 'owner-1', role: 'OWNER' } as any;

      await service.getDashboard(actor);

      expect(mockFinanceService.getRevenueByPeriod).toHaveBeenCalledTimes(1);
      expect(mockFinanceService.getMaterialCostsByPeriod).toHaveBeenCalledTimes(1);
      expect(mockFinanceService.getAverageOrderValue).toHaveBeenCalledTimes(1);
      expect(mockOrderService.getOrderCountsByPeriod).toHaveBeenCalledTimes(1);
      expect(mockOrderService.getConversionRate).toHaveBeenCalledTimes(1);
      expect(mockOrderService.getTopProducts).toHaveBeenCalledTimes(1);
      expect(mockOrderService.getTopCustomers).toHaveBeenCalledTimes(1);
      expect(mockProductionService.getAverageLeadTime).toHaveBeenCalledTimes(1);
      expect(mockShippingService.getOnTimeDeliveryRate).toHaveBeenCalledTimes(1);
      expect(mockProductionService.getRejectRate).toHaveBeenCalledTimes(1);
      expect(mockInventoryService.getStockAccuracy).toHaveBeenCalledTimes(1);
      expect(mockCustomerService.getRepeatCustomerRate).toHaveBeenCalledTimes(1);
      expect(mockCustomerChatService.getAverageResponseTime).toHaveBeenCalledTimes(1);
      expect(mockProductionService.getProductionCostPerProduct).toHaveBeenCalledTimes(1);
    });
  });
});
