import { TestBed, discardPeriodicTasks, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { MessageService } from 'primeng/api';

import { CashRegisterService } from './cash-register.service';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';
import { DeviceService } from './device.service';
import { AuthService } from './auth.service';
import { CashRegister } from '../models';

/**
 * Targeted spec for the cold-boot race fix in CashRegisterService.
 *
 * Validates the contract introduced when we centralised the linked-register
 * lookup behind `ensureLinkedRegisterResolved()`:
 *
 *   1. Concurrent callers share a single in-flight `/by-device/{uuid}`
 *      request — the promise is cached for the session lifetime.
 *
 *   2. `loadActiveSession()` waits for that resolution before querying
 *      `/cashregister/session`, so the request always carries the
 *      correct `?registerId=` filter on cold-boot.
 *
 *   3. Logout (auth flips to false) invalidates the cache, so a
 *      subsequent login on the same browser does not inherit the
 *      previous user/device's register state.
 */
describe('CashRegisterService — cold-boot race & promise cache', () => {
  let service: CashRegisterService;
  let api: jasmine.SpyObj<ApiService>;
  let auth: { isAuthenticated: ReturnType<typeof signal<boolean>>; branchId: number; currentUser: () => null };
  let deviceService: { deviceUuid: string };

  const fakeRegister: CashRegister = {
    id: 42,
    branchId: 1,
    name: 'Caja Principal',
    isActive: true,
    deviceUuid: 'mock-uuid',
  };

  /**
   * Minimal Dexie stub — only the methods exercised by the code paths
   * under test are stubbed. Anything else surfaces as a spec failure
   * rather than silently no-op'ing.
   */
  function makeDbStub(): unknown {
    const stubTable = {
      put:    jasmine.createSpy('put').and.callFake(() => Promise.resolve()),
      bulkPut: jasmine.createSpy('bulkPut').and.callFake(() => Promise.resolve()),
      toArray: jasmine.createSpy('toArray').and.callFake(() => Promise.resolve([])),
      where:  jasmine.createSpy('where').and.returnValue({ first: () => Promise.resolve(null) }),
    };
    // Chainable stub for the `orders` table — the service's
    // `computeCashSalesTotal()` walks `db.orders.where(..).aboveOrEqual(..).and(..).each(..)`.
    // Returning the same chain object on every step keeps the spy simple
    // and lets the liveQuery resolve cleanly to a 0-cent total.
    const ordersChain: { where: () => unknown; aboveOrEqual: () => unknown; and: () => unknown; each: () => Promise<void> } = {
      where: () => ordersChain,
      aboveOrEqual: () => ordersChain,
      and: () => ordersChain,
      each: () => Promise.resolve(),
    };
    return {
      cashRegisters: { ...stubTable, put: jasmine.createSpy('cr.put').and.callFake(() => Promise.resolve()) },
      cashSessions:  { ...stubTable, put: jasmine.createSpy('cs.put').and.callFake(() => Promise.resolve()) },
      cashMovements: { ...stubTable, put: jasmine.createSpy('cm.put').and.callFake(() => Promise.resolve()) },
      orders:        ordersChain,
    };
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'put', 'patch']);
    api.get.and.returnValue(of(null));
    api.post.and.returnValue(of(null));
    api.put.and.returnValue(of(null));
    api.patch.and.returnValue(of(null));

    deviceService = { deviceUuid: 'mock-uuid' };
    auth = {
      isAuthenticated: signal(false),
      branchId: 1,
      currentUser: () => null,
    };

    TestBed.configureTestingModule({
      providers: [
        CashRegisterService,
        { provide: ApiService,      useValue: api },
        { provide: DatabaseService, useValue: makeDbStub() },
        { provide: DeviceService,   useValue: deviceService },
        { provide: AuthService,     useValue: auth },
        MessageService,
      ],
    });

    service = TestBed.inject(CashRegisterService);
  });

  it('coalesces concurrent linked-register lookups into a single backend fetch', fakeAsync(() => {
    // Stage a 1s-delayed register response so any unprotected concurrent
    // caller would expose itself as a duplicate `api.get` call.
    const registerSubject = new Subject<CashRegister | null>();
    (api.get as jasmine.Spy).and.callFake((url: string) => {
      if (url.startsWith('/cashregister/registers/by-device/')) {
        return registerSubject.asObservable();
      }
      return of(null);
    });

    // Two concurrent callers — simulates the constructor effect firing
    // alongside the explicit call from PIN login.
    const p1 = (service as unknown as { ensureLinkedRegisterResolved(): Promise<CashRegister | null> })
      .ensureLinkedRegisterResolved();
    const p2 = (service as unknown as { ensureLinkedRegisterResolved(): Promise<CashRegister | null> })
      .ensureLinkedRegisterResolved();

    flushMicrotasks();

    // The cache must serialise both callers onto the same in-flight request.
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/cashregister/registers/by-device/mock-uuid');

    // Resolve the in-flight request after the simulated 1s of latency.
    registerSubject.next(fakeRegister);
    registerSubject.complete();
    flushMicrotasks();

    // Both callers see the same value; still only ONE network call was made.
    let r1: CashRegister | null | undefined;
    let r2: CashRegister | null | undefined;
    p1.then(v => { r1 = v; });
    p2.then(v => { r2 = v; });
    flushMicrotasks();

    expect(r1).toEqual(fakeRegister);
    expect(r2).toEqual(fakeRegister);
    expect(api.get).toHaveBeenCalledTimes(1);
  }));

  it('loadActiveSession waits for the linked register before querying the session endpoint', fakeAsync(() => {
    const registerSubject = new Subject<CashRegister | null>();
    const sessionSubject  = new Subject<unknown>();
    const calls: string[] = [];

    (api.get as jasmine.Spy).and.callFake((url: string) => {
      calls.push(url);
      if (url.startsWith('/cashregister/registers/by-device/')) {
        return registerSubject.asObservable();
      }
      if (url.startsWith('/cashregister/session')) {
        return sessionSubject.asObservable();
      }
      return of(null);
    });

    const loadPromise = service.loadActiveSession(1);
    flushMicrotasks();

    // Strict ordering: only the register lookup has fired so far.
    expect(calls).toEqual(['/cashregister/registers/by-device/mock-uuid']);

    // Simulate ~1s of latency on the register call.
    tick(1000);
    registerSubject.next(fakeRegister);
    registerSubject.complete();
    flushMicrotasks();

    // Now — and only now — the session query may run, AND it must carry
    // the registerId filter sourced from the just-resolved register.
    expect(calls.length).toBe(2);
    expect(calls[1]).toBe('/cashregister/session?registerId=42');

    // Drain the session promise so loadActiveSession resolves cleanly.
    sessionSubject.next(null);
    sessionSubject.complete();
    flushMicrotasks();

    let resolved = false;
    loadPromise.then(() => { resolved = true; });
    flushMicrotasks();
    expect(resolved).toBeTrue();

    // `loadActiveSession` kicks off `setInterval`-based polling on success;
    // discard the periodic timer so fakeAsync can finalise cleanly.
    discardPeriodicTasks();
  }));

  it('clears the linked-register cache when authentication flips to false', fakeAsync(() => {
    const registerSubject = new Subject<CashRegister | null>();
    (api.get as jasmine.Spy).and.callFake((url: string) => {
      if (url.startsWith('/cashregister/registers/by-device/')) {
        return registerSubject.asObservable();
      }
      return of(null);
    });

    // First login resolves the linked register.
    auth.isAuthenticated.set(true);
    TestBed.flushEffects();
    flushMicrotasks();

    registerSubject.next(fakeRegister);
    registerSubject.complete();
    flushMicrotasks();

    expect(api.get).toHaveBeenCalledWith('/cashregister/registers/by-device/mock-uuid');
    expect(service.linkedRegister()).toEqual(fakeRegister);

    // Logout: signal flips to false; effect must reset the cache + signals.
    auth.isAuthenticated.set(false);
    TestBed.flushEffects();
    flushMicrotasks();

    expect(service.linkedRegister()).toBeNull();
    expect(service.activeSession()).toBeNull();

    // Subsequent login must trigger a fresh fetch — the cached promise
    // was nulled, so the in-flight observable must be replayed.
    api.get.calls.reset();
    const fresh = new Subject<CashRegister | null>();
    (api.get as jasmine.Spy).and.callFake((url: string) => {
      if (url.startsWith('/cashregister/registers/by-device/')) {
        return fresh.asObservable();
      }
      return of(null);
    });

    auth.isAuthenticated.set(true);
    TestBed.flushEffects();
    flushMicrotasks();

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/cashregister/registers/by-device/mock-uuid');

    // Tidy up so loadActiveSession-style flows don't leave a dangling subject.
    fresh.next(null);
    fresh.complete();
    flushMicrotasks();
  }));
});
