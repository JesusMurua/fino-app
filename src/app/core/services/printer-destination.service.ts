import { Injectable, computed, inject, signal } from '@angular/core';

import { PrinterDestination, PrinterDestinationForm } from '../models';
import { DatabaseService } from './database.service';

/**
 * Signal-based, offline-first service for managing printer destinations.
 * All state is stored in Dexie (IndexedDB). No API calls — printer config is device-local.
 */
@Injectable({ providedIn: 'root' })
export class PrinterDestinationService {

  //#region Injections

  private readonly db = inject(DatabaseService);

  //#endregion

  //#region Signals

  readonly destinations = signal<PrinterDestination[]>([]);
  readonly isLoading = signal<boolean>(false);

  /** Active destinations sorted by sortOrder — for dropdown in product form */
  readonly activeDestinations = computed(() =>
    this.destinations()
      .filter(d => d.isActive)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder),
  );

  /** The single default destination for customer receipt tickets */
  readonly defaultDestination = computed<PrinterDestination | null>(() =>
    this.destinations().find(d => d.isDefault) ?? null,
  );

  //#endregion

  //#region Load

  /** Loads all printer destinations from Dexie ordered by sortOrder */
  async loadFromLocal(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await this.db.printerDestinations.orderBy('sortOrder').toArray();
      this.destinations.set(data);
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion

  //#region CRUD

  /**
   * Creates a new printer destination.
   * The first destination created automatically becomes the default.
   */
  async create(form: PrinterDestinationForm): Promise<void> {
    const existing = this.destinations();
    const maxId    = existing.length > 0 ? Math.max(...existing.map(d => d.id)) : 0;
    const maxSort  = existing.length > 0 ? Math.max(...existing.map(d => d.sortOrder)) : 0;

    const newDest: PrinterDestination = {
      id:             maxId + 1,
      name:           form.name.trim(),
      connectionType: form.connectionType,
      address:        form.address.trim() || undefined,
      isDefault:      existing.length === 0,
      isActive:       form.isActive,
      sortOrder:      maxSort + 1,
    };

    await this.db.printerDestinations.add(newDest);
    this.destinations.update(list => [...list, newDest]);
  }

  /**
   * Partially updates an existing printer destination.
   * @param id Destination ID to update
   * @param patch Fields to update
   */
  async update(id: number, patch: Partial<Omit<PrinterDestination, 'id'>>): Promise<void> {
    await this.db.printerDestinations.update(id, patch);
    this.destinations.update(list =>
      list.map(d => d.id === id ? { ...d, ...patch } : d),
    );
  }

  /**
   * Deletes a printer destination.
   * Throws an error if any product currently references this destination.
   * @param id Destination ID to delete
   */
  async delete(id: number): Promise<void> {
    const products     = await this.db.products.toArray();
    const refCount     = products.filter(p => p.printingDestinationId === id).length;

    if (refCount > 0) {
      const dest = this.destinations().find(d => d.id === id);
      throw new Error(
        `No se puede eliminar "${dest?.name ?? id}": está asignado a ${refCount} producto(s).`,
      );
    }

    await this.db.printerDestinations.delete(id);
    this.destinations.update(list => list.filter(d => d.id !== id));
  }

  /**
   * Sets the given destination as the customer receipt default.
   * Clears isDefault on all other destinations to enforce the single-default invariant.
   * @param id Destination ID to set as default
   */
  async setDefault(id: number): Promise<void> {
    await this.db.printerDestinations.toCollection().modify((d: PrinterDestination) => {
      d.isDefault = d.id === id;
    });

    this.destinations.update(list =>
      list.map(d => ({ ...d, isDefault: d.id === id })),
    );
  }

  //#endregion

}
