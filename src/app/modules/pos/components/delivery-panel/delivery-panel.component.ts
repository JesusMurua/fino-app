import { Component, computed, effect, inject, signal } from '@angular/core';
import { SidebarModule } from 'primeng/sidebar';
import { MessageService } from 'primeng/api';

import { DeliveryService } from '../../../../core/services/delivery.service';
import { DeliveryOrderCardComponent } from '../delivery-order-card/delivery-order-card.component';

@Component({
  selector: 'app-delivery-panel',
  standalone: true,
  imports: [SidebarModule, DeliveryOrderCardComponent],
  templateUrl: './delivery-panel.component.html',
  styleUrl: './delivery-panel.component.scss',
})
export class DeliveryPanelComponent {

  readonly deliveryService = inject(DeliveryService);
  private readonly messageService = inject(MessageService);

  readonly activeTab = signal<'pending' | 'accepted' | 'ready'>('pending');

  readonly activeOrders = computed(() => {
    const tab = this.activeTab();
    if (tab === 'pending') return this.deliveryService.pendingOrders();
    if (tab === 'accepted') return this.deliveryService.acceptedOrders();
    return this.deliveryService.readyOrders();
  });

  constructor() {
    effect(() => {
      if (this.deliveryService.isOpen()) {
        this.deliveryService.loadActiveOrders();
      }
    });
  }

  handleAccept(orderId: string): void {
    this.deliveryService.acceptOrder(orderId).subscribe({
      next: () => this.messageService.add({ severity: 'success', summary: 'Orden aceptada', life: 3000 }),
      error: () => this.messageService.add({ severity: 'error', summary: 'Error al aceptar', life: 3000 }),
    });
  }

  handleReject(orderId: string): void {
    this.deliveryService.rejectOrder(orderId, 'Rechazada desde POS').subscribe({
      next: () => this.messageService.add({ severity: 'info', summary: 'Orden rechazada', life: 3000 }),
      error: () => this.messageService.add({ severity: 'error', summary: 'Error al rechazar', life: 3000 }),
    });
  }

  handleMarkReady(orderId: string): void {
    this.deliveryService.markReady(orderId).subscribe({
      next: () => this.messageService.add({ severity: 'success', summary: 'Orden lista para recoger', life: 3000 }),
      error: () => this.messageService.add({ severity: 'error', summary: 'Error al marcar lista', life: 3000 }),
    });
  }

  handleMarkPickedUp(orderId: string): void {
    this.deliveryService.markPickedUp(orderId).subscribe({
      next: () => this.messageService.add({ severity: 'success', summary: 'Orden recogida', life: 3000 }),
      error: () => this.messageService.add({ severity: 'error', summary: 'Error al marcar recogida', life: 3000 }),
    });
  }
}
