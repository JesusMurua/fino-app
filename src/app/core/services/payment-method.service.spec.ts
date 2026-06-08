import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { PaymentMethodService } from './payment-method.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { AvailablePaymentMethod } from '../models/available-payment-method.model';
import { PaymentCategory } from '../enums/payment-category.enum';

/**
 * Spec for the three-layer degradation contract of PaymentMethodService:
 * network → localStorage → hardcoded fallback. The cashier must always
 * end up with a usable list and `loaded()` must always flip true.
 */
describe('PaymentMethodService — three-layer degradation', () => {
  let service: PaymentMethodService;
  let api: jasmine.SpyObj<ApiService>;
  let auth: { businessId: number };

  const apiMethods: AvailablePaymentMethod[] = [
    {
      id: 6,
      code: 'Card',
      name: 'Tarjeta',
      category: PaymentCategory.Card,
      supportsOverpay: false,
      requiresReference: false,
      requiresCustomer: false,
      sortOrder: 20,
    },
    {
      id: 5,
      code: 'Cash',
      name: 'Efectivo',
      category: PaymentCategory.Cash,
      supportsOverpay: true,
      requiresReference: false,
      requiresCustomer: false,
      sortOrder: 10,
    },
  ];

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    auth = { businessId: 41 };

    TestBed.configureTestingModule({
      providers: [
        PaymentMethodService,
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    });

    localStorage.removeItem('payment_methods_41');
    service = TestBed.inject(PaymentMethodService);
  });

  it('starts unloaded with empty methods', () => {
    expect(service.loaded()).toBeFalse();
    expect(service.availableMethods()).toEqual([]);
    expect(service.usedFallback()).toBeFalse();
  });

  it('loads from API, sorts by sortOrder, and caches', async () => {
    api.get.and.returnValue(of(apiMethods));

    await service.loadAvailable();

    expect(service.loaded()).toBeTrue();
    expect(service.usedFallback()).toBeFalse();
    const list = service.availableMethods();
    expect(list.length).toBe(2);
    expect(list[0].code).toBe('Cash'); // sortOrder 10 < 20
    expect(list[1].code).toBe('Card');

    const cached = JSON.parse(localStorage.getItem('payment_methods_41')!);
    expect(cached.length).toBe(2);
  });

  it('falls back to localStorage cache when API fails', async () => {
    localStorage.setItem('payment_methods_41', JSON.stringify(apiMethods));
    api.get.and.returnValue(throwError(() => new Error('network')));

    await service.loadAvailable();

    expect(service.loaded()).toBeTrue();
    expect(service.usedFallback()).toBeFalse();
    expect(service.availableMethods().length).toBe(2);
  });

  it('uses hardcoded fallback when API fails AND cache is empty', async () => {
    api.get.and.returnValue(throwError(() => new Error('offline')));

    await service.loadAvailable();

    expect(service.loaded()).toBeTrue();
    expect(service.usedFallback()).toBeTrue();
    const codes = service.availableMethods().map(m => m.code);
    expect(codes).toEqual(['Cash', 'Card', 'Transfer', 'Other']);
  });

  it('uses hardcoded fallback when API returns empty array', async () => {
    api.get.and.returnValue(of([]));

    await service.loadAvailable();

    expect(service.usedFallback()).toBeTrue();
    expect(service.availableMethods().length).toBe(4);
  });

  it('getByCode resolves a method by its stable code', async () => {
    api.get.and.returnValue(of(apiMethods));
    await service.loadAvailable();

    expect(service.getByCode('Cash')?.id).toBe(5);
    expect(service.getByCode('Nonexistent')).toBeUndefined();
  });
});
