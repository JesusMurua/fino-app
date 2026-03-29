import { Pipe, PipeTransform } from '@angular/core';

/**
 * Converts a price in cents to a formatted MXN currency string.
 * Usage: {{ product.priceCents | price }}  →  "$85.00"
 */
@Pipe({
  name: 'price',
  standalone: true,
})
export class PricePipe implements PipeTransform {
  private readonly formatter = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  });

  transform(cents: number | null | undefined): string {
    return this.formatter.format((cents ?? 0) / 100);
  }
}
