import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { ButtonModule } from 'primeng/button';
import { CalendarModule } from 'primeng/calendar';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';

import { Category, Product, Promotion, PromotionScope, PromotionType } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { ProductService } from '../../../../core/services/product.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/** Day-of-week bitmask values: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64 */
const DAY_BITS = [
  { label: 'Lun', value: 1 },
  { label: 'Mar', value: 2 },
  { label: 'Mié', value: 4 },
  { label: 'Jue', value: 8 },
  { label: 'Vie', value: 16 },
  { label: 'Sáb', value: 32 },
  { label: 'Dom', value: 64 },
];

@Component({
  selector: 'app-admin-promotions',
  standalone: true,
  imports: [
    NgClass,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    CalendarModule,
    CheckboxModule,
    ConfirmDialogModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputSwitchModule,
    InputTextModule,
    InputTextareaModule,
    SelectButtonModule,
    TableModule,
    PricePipe,
  ],
  templateUrl: './admin-promotions.component.html',
  styleUrl: './admin-promotions.component.scss',
  providers: [ConfirmationService],
})
export class AdminPromotionsComponent implements OnInit {

  //#region Properties

  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly productService = inject(ProductService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly promotions = signal<Promotion[]>([]);
  readonly isLoading = signal(true);

  // ---- Dialog state ----
  dialogVisible = false;
  editingPromotion: Promotion | null = null;
  form!: FormGroup;

  // ---- Dropdown data ----
  readonly products = this.productService.products;
  readonly categories = this.productService.categories;

  // ---- Option sets ----
  readonly dayBits = DAY_BITS;

  readonly typeOptions = [
    { label: 'Porcentaje',         value: PromotionType.Percentage },
    { label: 'Monto fijo',        value: PromotionType.Fixed },
    { label: '2×1',               value: PromotionType.Bogo },
    { label: 'Bundle',            value: PromotionType.Bundle },
    { label: 'Desc. de orden',    value: PromotionType.OrderDiscount },
    { label: 'Producto gratis',   value: PromotionType.FreeProduct },
  ];

  readonly scopeOptions = [
    { label: 'Todo',       value: PromotionScope.All },
    { label: 'Categoría',  value: PromotionScope.Category },
    { label: 'Producto',   value: PromotionScope.Product },
  ];

  //#endregion

  //#region Constructor

  constructor() {
    this.buildForm();

    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.loadPromotions();
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadPromotions();
  }

  //#endregion

  //#region Data Loading

  /** Loads all promotions for the current branch from the API */
  private async loadPromotions(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await firstValueFrom(
        this.http.get<Promotion[]>(`${environment.apiUrl}/promotion`),
      );
      this.promotions.set(data);
    } catch {
      this.promotions.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion

  //#region Dialog Open/Close

  /** Opens dialog in create mode with empty form */
  openCreate(): void {
    this.editingPromotion = null;
    this.buildForm();
    this.dialogVisible = true;
  }

  /** Opens dialog in edit mode with populated form */
  openEdit(promo: Promotion): void {
    this.editingPromotion = promo;
    this.buildForm(promo);
    this.dialogVisible = true;
  }

  /** Closes the dialog */
  closeDialog(): void {
    this.dialogVisible = false;
  }

  //#endregion

  //#region CRUD

  /** Saves promotion — creates or updates based on editingPromotion */
  async savePromotion(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const payload = this.formToPayload(raw);

    try {
      if (this.editingPromotion) {
        await firstValueFrom(
          this.http.put(`${environment.apiUrl}/promotion/${this.editingPromotion.id}`, payload),
        );
      } else {
        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/promotion`, payload),
        );
      }
      this.dialogVisible = false;
      await this.loadPromotions();
    } catch (e) {
      console.warn('[AdminPromotions] Save failed:', e);
    }
  }

  /** Toggles isActive inline and saves immediately */
  async toggleActive(promo: Promotion): Promise<void> {
    try {
      await firstValueFrom(
        this.http.put(`${environment.apiUrl}/promotion/${promo.id}`, {
          ...promo,
          isActive: !promo.isActive,
        }),
      );
      await this.loadPromotions();
    } catch (e) {
      console.warn('[AdminPromotions] Toggle failed:', e);
    }
  }

  /** Deletes a promotion with confirmation dialog */
  deletePromotion(promo: Promotion): void {
    this.confirmationService.confirm({
      message: `¿Eliminar la promoción "${promo.name}"?`,
      header: 'Confirmar eliminación',
      icon: 'pi pi-trash',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      accept: async () => {
        try {
          await firstValueFrom(
            this.http.delete(`${environment.apiUrl}/promotion/${promo.id}`),
          );
          await this.loadPromotions();
        } catch (e) {
          console.warn('[AdminPromotions] Delete failed:', e);
        }
      },
    });
  }

  //#endregion

  //#region Form Helpers

  /** Returns true if a form control is invalid and touched */
  isInvalidField(name: string): boolean {
    const control = this.form.get(name);
    return !!(control?.invalid && control?.touched);
  }

  /** Current type selected in the form */
  get selectedType(): PromotionType {
    return this.form.get('type')?.value;
  }

  /** Current scope selected in the form */
  get selectedScope(): PromotionScope {
    return this.form.get('appliesTo')?.value;
  }

  //#endregion

  //#region Table Display Helpers

  /** Returns a human-readable label for the promotion type + value */
  typeLabel(promo: Promotion): string {
    switch (promo.type) {
      case PromotionType.Percentage:    return `${promo.value}%`;
      case PromotionType.Fixed:         return `$${(promo.value / 100).toFixed(2)}`;
      case PromotionType.Bogo:          return '2×1';
      case PromotionType.Bundle:        return `Lleva ${promo.minQuantity ?? 3} paga ${promo.paidQuantity ?? 2}`;
      case PromotionType.OrderDiscount: return `${promo.value}% en orden`;
      case PromotionType.FreeProduct:   return 'Producto gratis';
      default:                          return '—';
    }
  }

  /** Returns a label for the promotion scope */
  scopeLabel(promo: Promotion): string {
    switch (promo.appliesTo) {
      case PromotionScope.All:      return 'Todo';
      case PromotionScope.Category: return this.categoryName(promo.categoryId ?? 0);
      case PromotionScope.Product:  return this.productName(promo.productId ?? 0);
      default:                      return '—';
    }
  }

  /** Formats date range for display */
  dateRangeLabel(promo: Promotion): string {
    if (!promo.startsAt && !promo.endsAt) return 'Sin límite';
    const start = promo.startsAt ? new Date(promo.startsAt).toLocaleDateString('es-MX') : '—';
    const end = promo.endsAt ? new Date(promo.endsAt).toLocaleDateString('es-MX') : '—';
    return `${start} → ${end}`;
  }

  /** Returns day pills string from bitmask */
  daysLabel(promo: Promotion): string {
    if (promo.daysOfWeek == null || promo.daysOfWeek === 0) return 'Todos';
    return DAY_BITS
      .filter(d => (promo.daysOfWeek! & d.value) !== 0)
      .map(d => d.label)
      .join(', ');
  }

  //#endregion

  //#region Private Helpers

  /** Finds category name by ID */
  private categoryName(id: number): string {
    return this.categories().find(c => c.id === id)?.name ?? '—';
  }

  /** Finds product name by ID */
  private productName(id: number): string {
    return this.products().find(p => p.id === id)?.name ?? '—';
  }

  /** Builds the reactive form, optionally populated from an existing promotion */
  private buildForm(promo?: Promotion): void {
    const isFixedType = promo?.type === PromotionType.Fixed || promo?.type === PromotionType.OrderDiscount;
    const valuePesos = isFixedType ? (promo?.value ?? 0) / 100 : (promo?.value ?? 0);
    const minOrderPesos = promo?.minOrderCents ? promo.minOrderCents / 100 : null;

    const daysOfWeek = promo?.daysOfWeek ?? 0;

    this.form = this.fb.group({
      // Section 1 — Basic info
      name:           [promo?.name ?? '', Validators.required],
      description:    [promo?.description ?? ''],

      // Section 2 — Type
      type:           [promo?.type ?? PromotionType.Percentage, Validators.required],
      value:          [valuePesos],
      minQuantity:    [promo?.minQuantity ?? 3],
      paidQuantity:   [promo?.paidQuantity ?? 2],
      freeProductId:  [promo?.freeProductId ?? null],

      // Section 3 — Scope
      appliesTo:      [promo?.appliesTo ?? PromotionScope.All, Validators.required],
      categoryId:     [promo?.categoryId ?? null],
      productId:      [promo?.productId ?? null],

      // Section 4 — Validity & limits
      dayMon:         [(daysOfWeek & 1) !== 0],
      dayTue:         [(daysOfWeek & 2) !== 0],
      dayWed:         [(daysOfWeek & 4) !== 0],
      dayThu:         [(daysOfWeek & 8) !== 0],
      dayFri:         [(daysOfWeek & 16) !== 0],
      daySat:         [(daysOfWeek & 32) !== 0],
      daySun:         [(daysOfWeek & 64) !== 0],
      startsAt:       [promo?.startsAt ? new Date(promo.startsAt) : null],
      endsAt:         [promo?.endsAt ? new Date(promo.endsAt) : null],
      minOrderPesos:  [minOrderPesos],
      maxUsesTotal:   [promo?.maxUsesTotal ?? null],
      maxUsesPerDay:  [promo?.maxUsesPerDay ?? null],

      // Section 5 — Coupon & stacking
      couponCode:     [promo?.couponCode ?? ''],
      isStackable:    [promo?.isStackable ?? false],

      // Section 6 — Status
      isActive:       [promo?.isActive ?? true],
    });
  }

  /** Converts form values to API payload */
  private formToPayload(raw: any): Record<string, unknown> {
    const type: PromotionType = raw.type;
    const isFixedType = type === PromotionType.Fixed || type === PromotionType.OrderDiscount;

    // Compute days bitmask
    let daysOfWeek: number | null = 0;
    if (raw.dayMon) daysOfWeek! += 1;
    if (raw.dayTue) daysOfWeek! += 2;
    if (raw.dayWed) daysOfWeek! += 4;
    if (raw.dayThu) daysOfWeek! += 8;
    if (raw.dayFri) daysOfWeek! += 16;
    if (raw.daySat) daysOfWeek! += 32;
    if (raw.daySun) daysOfWeek! += 64;
    if (daysOfWeek === 0) daysOfWeek = null;

    const couponCode = raw.couponCode?.trim().toUpperCase() || null;

    return {
      branchId: this.authService.branchId,
      name: raw.name.trim(),
      description: raw.description?.trim() || null,
      type,
      appliesTo: raw.appliesTo,
      value: isFixedType ? Math.round((raw.value ?? 0) * 100) : (raw.value ?? 0),
      minQuantity: type === PromotionType.Bundle ? raw.minQuantity : null,
      paidQuantity: type === PromotionType.Bundle ? raw.paidQuantity : null,
      freeProductId: type === PromotionType.FreeProduct ? raw.freeProductId : null,
      categoryId: raw.appliesTo === PromotionScope.Category ? raw.categoryId : null,
      productId: raw.appliesTo === PromotionScope.Product ? raw.productId : null,
      daysOfWeek,
      startsAt: raw.startsAt ? (raw.startsAt as Date).toISOString() : null,
      endsAt: raw.endsAt ? (raw.endsAt as Date).toISOString() : null,
      minOrderCents: raw.minOrderPesos ? Math.round(raw.minOrderPesos * 100) : null,
      maxUsesTotal: raw.maxUsesTotal || null,
      maxUsesPerDay: raw.maxUsesPerDay || null,
      couponCode,
      isStackable: raw.isStackable ?? false,
      isActive: raw.isActive ?? true,
    };
  }

  //#endregion

}
