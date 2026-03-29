import { Component, OnInit, effect, inject, signal } from '@angular/core';

import { Order, PaymentMethod, getCashAmountCents, getCardAmountCents } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { DatabaseService } from '../../../../core/services/database.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

interface TopProduct {
  name: string;
  count: number;
}

interface CancellationGroup {
  reason: string;
  count: number;
  totalCents: number;
}

interface DashboardData {
  totalCents: number;
  orderCount: number;
  averageTicketCents: number;
  topMethod: PaymentMethod | null;
  cashCents: number;
  cardCents: number;
  topProducts: TopProduct[];
  orders: Order[];
  cancelledCount: number;
  cancelledTotalCents: number;
  cancellationGroups: CancellationGroup[];
  cancelledOrders: Order[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [PricePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {

  private readonly authService = inject(AuthService);

  readonly data = signal<DashboardData | null>(null);
  readonly isLoading = signal(true);

  constructor(private readonly db: DatabaseService) {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.loadData();
    }, { allowSignalWrites: true });
  }

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  /** Loads today's orders for the active branch and computes dashboard KPIs */
  async loadData(): Promise<void> {
    this.isLoading.set(true);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const branchId = this.authService.activeBranchId();

    const allOrders = await this.db.orders
      .where('createdAt')
      .aboveOrEqual(todayStart)
      .filter(o => o.branchId === branchId)
      .toArray();

    // Separate completed from cancelled
    const completedOrders = allOrders.filter(o => o.cancellationStatus !== 'cancelled');
    const cancelledOrders = allOrders.filter(o => o.cancellationStatus === 'cancelled');

    // KPI metrics — only completed orders
    const totalCents = completedOrders.reduce((s, o) => s + o.totalCents, 0);
    const orderCount = completedOrders.length;
    const averageTicketCents = orderCount > 0 ? Math.round(totalCents / orderCount) : 0;

    const cashCents = completedOrders.reduce((s, o) => s + getCashAmountCents(o), 0);
    const cardCents = completedOrders.reduce((s, o) => s + getCardAmountCents(o), 0);
    const topMethod: PaymentMethod | null = orderCount === 0
      ? null
      : cashCents >= cardCents ? PaymentMethod.Cash : PaymentMethod.Card;

    // Top 5 products — only completed orders
    const productCounts = new Map<string, number>();
    for (const order of completedOrders) {
      for (const item of order.items) {
        const key = item.product.name;
        productCounts.set(key, (productCounts.get(key) ?? 0) + item.quantity);
      }
    }

    const topProducts: TopProduct[] = [...productCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Cancellation groups
    const cancelledTotalCents = cancelledOrders.reduce((s, o) => s + o.totalCents, 0);
    const reasonMap = new Map<string, { count: number; totalCents: number }>();
    for (const order of cancelledOrders) {
      const reason = order.cancellationReason ?? 'Sin motivo';
      const existing = reasonMap.get(reason) ?? { count: 0, totalCents: 0 };
      existing.count += 1;
      existing.totalCents += order.totalCents;
      reasonMap.set(reason, existing);
    }

    const cancellationGroups: CancellationGroup[] = [...reasonMap.entries()]
      .map(([reason, { count, totalCents: cents }]) => ({ reason, count, totalCents: cents }))
      .sort((a, b) => b.totalCents - a.totalCents);

    this.data.set({
      totalCents,
      orderCount,
      averageTicketCents,
      topMethod,
      cashCents,
      cardCents,
      topProducts,
      orders: [...allOrders].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
      cancelledCount: cancelledOrders.length,
      cancelledTotalCents,
      cancellationGroups,
      cancelledOrders: [...cancelledOrders].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    });

    this.isLoading.set(false);
  }

  /** Returns the display status label for an order */
  getStatusLabel(order: Order): string {
    if (order.cancellationStatus === 'cancelled') return 'Cancelada';
    if (order.kitchenStatus === 'Delivered') return 'Entregada';
    if (order.deliveryStatus === 'delivered') return 'Entregada';
    if (order.kitchenStatus === 'Ready') return 'Listo';
    if (order.kitchenStatus === 'Preparing') return 'Preparando';
    if (order.kitchenStatus === 'Pending') return 'En cocina';
    return 'Nueva';
  }

  /** Formats a Date to HH:MM */
  formatTime(date: Date | string): string {
    return new Date(date).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

}
