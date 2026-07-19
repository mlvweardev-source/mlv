'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TrendingUp,
  ShoppingCart,
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  BarChart3,
  Package,
  Truck,
  Repeat,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { DashboardData } from '@/lib/types';

const PIE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444'];

function formatRp(value: number): string {
  return `Rp ${value.toLocaleString('id-ID')}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'month' | 'week' | 'custom'>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const fetchDashboard = async (from?: string, to?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const result = await apiFetch<DashboardData>(`/analytics/dashboard${qs ? `?${qs}` : ''}`);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const now = new Date();
    let from: string | undefined;
    let to: string | undefined;

    if (period === 'month') {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      to = now.toISOString().slice(0, 10);
    } else if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      from = weekAgo.toISOString().slice(0, 10);
      to = now.toISOString().slice(0, 10);
    } else if (period === 'custom') {
      from = customFrom || undefined;
      to = customTo || undefined;
    }

    fetchDashboard(from, to);
  }, [period, customFrom, customTo]);

  const isOwner = !!data?.omzet;

  // Chart data for monthly revenue
  const revenueChartData =
    data?.omzet?.byMonth.map((m) => ({
      month: m.month,
      revenue: m.total / 1000000, // in juta
    })) ?? [];

  // Pie chart data for order status
  const orderPieData = data
    ? [
        { name: 'Aktif', value: data.orderCounts.active },
        { name: 'Selesai', value: data.orderCounts.completed },
        { name: 'Dibatalkan', value: data.orderCounts.cancelled },
      ].filter((d) => d.value > 0)
    : [];

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard Analytics</h1>
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Periode: {data.period.from} s/d {data.period.to}
          </p>
        </div>

        {/* Period Filter */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPeriod('month')}
            data-testid="period-month"
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              period === 'month'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            Bulan Ini
          </button>
          <button
            onClick={() => setPeriod('week')}
            data-testid="period-week"
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              period === 'week'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            Minggu Ini
          </button>
          <button
            onClick={() => setPeriod('custom')}
            data-testid="period-custom"
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              period === 'custom'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            Custom
          </button>
          {period === 'custom' && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                data-testid="period-from"
                className="rounded-md border bg-background px-2 py-1 text-sm"
              />
              <span className="text-xs text-muted-foreground">s/d</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                data-testid="period-to"
                className="rounded-md border bg-background px-2 py-1 text-sm"
              />
            </div>
          )}
        </div>
      </div>

      {/* Financial KPIs (Owner-only) */}
      {isOwner && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card data-testid="kpi-omzet">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Omzet</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatRp(data.omzet!.total)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.aov?.orderCount ?? 0} order berhasil
              </p>
            </CardContent>
          </Card>

          <Card data-testid="kpi-profit">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Profit</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p
                className={`text-2xl font-bold ${data.profit!.total >= 0 ? 'text-emerald-600' : 'text-destructive'}`}
              >
                {formatRp(data.profit!.total)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Bahan: {formatRp(data.profit!.materialCost)} | Jahit:{' '}
                {formatRp(data.profit!.productionCost)}
              </p>
            </CardContent>
          </Card>

          <Card data-testid="kpi-aov">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">AOV</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatRp(data.aov!.value)}</p>
              <p className="text-xs text-muted-foreground mt-1">Rata-rata per order</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Operational KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card data-testid="kpi-order-aktif">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Order Aktif</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.orderCounts.active}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Order Selesai
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.orderCounts.completed}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Conversion Rate
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPercent(data.conversionRate.rate)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.conversionRate.confirmedCount}/
              {data.conversionRate.draftCount + data.conversionRate.confirmedCount} order
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Dibatalkan</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.orderCounts.cancelled}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Revenue Line Chart (Owner-only) */}
        {isOwner && revenueChartData.length > 0 && (
          <Card data-testid="chart-revenue">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Omzet Bulanan (Juta Rp)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={
                      ((value: number | string) => [
                        `Rp ${(Number(value) * 1000000).toLocaleString('id-ID')}`,
                        'Omzet',
                      ]) as never
                    }
                  />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Order Status Pie Chart */}
        {orderPieData.length > 0 && (
          <Card data-testid="chart-order-status">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Status Order</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={orderPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {orderPieData.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Production & Quality Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Lead Time Rata-rata
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {data.leadTime.averageHours !== null ? `${data.leadTime.averageHours} jam` : '—'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              On-Time Delivery
            </CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {data.onTimeDelivery.total > 0 ? formatPercent(data.onTimeDelivery.rate) : '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.onTimeDelivery.onTime}/{data.onTimeDelivery.total} pengiriman
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Reject Rate QC
            </CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {data.rejectRate.total > 0 ? formatPercent(data.rejectRate.rate) : '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.rejectRate.rejected}/{data.rejectRate.total} task
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Stock Accuracy
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPercent(data.stockAccuracy.accuracy)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.stockAccuracy.adjustments} adj / {data.stockAccuracy.totalMovements} movement
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Customer Metrics */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Repeat Customer Rate
            </CardTitle>
            <Repeat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPercent(data.repeatCustomer.rate)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.repeatCustomer.repeatCount}/{data.repeatCustomer.totalActive} customer
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Response Time CS
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {data.responseTimeCS.averageMinutes !== null
                ? `${data.responseTimeCS.averageMinutes} menit`
                : '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Termasuk AI bot</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Tables (Owner-only) */}
      {isOwner && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Top Produk</CardTitle>
              <CardDescription>Berdasarkan revenue dalam periode</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2">Produk</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p) => (
                    <tr key={p.productType} className="border-b last:border-0">
                      <td className="py-2 font-medium">{p.productType}</td>
                      <td className="py-2 text-right">{p.qty}</td>
                      <td className="py-2 text-right">{formatRp(p.revenue)}</td>
                    </tr>
                  ))}
                  {data.topProducts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-muted-foreground">
                        Belum ada data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Top Customer</CardTitle>
              <CardDescription>Berdasarkan total belanja dalam periode</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2">Customer</th>
                    <th className="pb-2 text-right">Order</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topCustomers.map((c) => (
                    <tr key={c.customerId} className="border-b last:border-0">
                      <td className="py-2 font-medium">{c.nama}</td>
                      <td className="py-2 text-right">{c.orderCount}</td>
                      <td className="py-2 text-right">{formatRp(c.totalSpent)}</td>
                    </tr>
                  ))}
                  {data.topCustomers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-muted-foreground">
                        Belum ada data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
