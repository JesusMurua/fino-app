import { Component, Input, OnInit, computed, signal } from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { Router } from '@angular/router';
import { CheckboxModule } from 'primeng/checkbox';
import { RadioButtonModule } from 'primeng/radiobutton';
import { InputTextareaModule } from 'primeng/inputtextarea';

import {
  Product,
  ProductExtra,
  ProductModifierGroup,
  ProductSize,
  calcUnitPriceCents,
} from '../../../../core/models';
import { CartService } from '../../../../core/services/cart.service';
import { DatabaseService } from '../../../../core/services/database.service';
import { ProductService } from '../../../../core/services/product.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/** Reactive form shape for the kiosk product detail page */
interface DetailForm {
  sizeId:   FormControl<number | null>;
  /** Map of groupId → boolean FormArray (one control per extra in the group) */
  groups:   FormGroup<Record<string, FormArray<FormControl<boolean>>>>;
  quantity: FormControl<number>;
  notes:    FormControl<string>;
}

/** Cross-group validator — enforces min/max/isRequired per ProductModifierGroup */
function kioskModifierGroupsValidator(groups: ProductModifierGroup[]): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const form = control as FormGroup<Record<string, FormArray<FormControl<boolean>>>>;
    const errors: Record<string, { min?: number; max?: number; required?: boolean }> = {};

    for (const group of groups) {
      const arr = form.controls[String(group.id)];
      if (!arr) continue;

      const count = arr.controls.reduce((n, c) => n + (c.value ? 1 : 0), 0);
      const required = group.isRequired && count === 0;
      const belowMin = group.minSelectable > 0 && count < group.minSelectable;
      const aboveMax = group.maxSelectable > 0 && count > group.maxSelectable;

      if (required || belowMin || aboveMax) {
        errors[group.id] = {
          ...(belowMin ? { min: group.minSelectable } : {}),
          ...(aboveMax ? { max: group.maxSelectable } : {}),
          ...(required ? { required: true } : {}),
        };
      }
    }

    return Object.keys(errors).length > 0 ? { modifierGroups: errors } : null;
  };
}

@Component({
  selector: 'app-kiosk-detail',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RadioButtonModule,
    CheckboxModule,
    InputTextareaModule,
    PricePipe,
  ],
  templateUrl: './kiosk-detail.component.html',
  styleUrl: './kiosk-detail.component.scss',
})
export class KioskDetailComponent implements OnInit {

  //#region Inputs
  /** Route param — bound via withComponentInputBinding() in app.config.ts */
  @Input({ required: true }) id!: string;
  //#endregion

  //#region Properties
  readonly product = signal<Product | null>(null);
  form!: FormGroup<DetailForm>;

  /** Live price preview updated as form values change */
  readonly previewPriceCents = signal(0);

  /** Modifier groups sorted by sortOrder — convenience for the template */
  readonly sortedGroups = computed<ProductModifierGroup[]>(() => {
    const groups = this.product()?.modifierGroups ?? [];
    return [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  });

  /** All available image URLs for the carousel (merged imageUrl + images[]) */
  readonly allImageUrls = signal<string[]>([]);

  /** Currently displayed image index in the carousel */
  readonly activeImageIndex = signal(0);

  /** Whether the lightbox overlay is open */
  readonly lightboxOpen = signal(false);
  //#endregion

  //#region Constructor
  constructor(
    private readonly fb: FormBuilder,
    private readonly productService: ProductService,
    private readonly db: DatabaseService,
    private readonly cartService: CartService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    const productId = Number(this.id);

    let product = this.productService.products().find(p => p.id === productId);
    if (!product) {
      product = await this.db.products.get(productId) ?? undefined;
    }

    if (!product) {
      this.router.navigate(['/kiosk/catalog']);
      return;
    }

    this.product.set(product);
    this.buildImageUrls(product);
    this.buildForm(product);
    this.updatePreview();
  }

  //#endregion

  //#region Image Carousel

  /** Builds a merged list of image URLs from imageUrl and images[] */
  private buildImageUrls(product: Product): void {
    const urls: string[] = [];
    if (product.images?.length) {
      urls.push(...product.images
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(i => i.url));
    } else if (product.imageUrl) {
      urls.push(product.imageUrl);
    }
    this.allImageUrls.set(urls);
    this.activeImageIndex.set(0);
  }

  /** Navigates to the previous image */
  prevImage(): void {
    const total = this.allImageUrls().length;
    if (total <= 1) return;
    this.activeImageIndex.update(i => (i - 1 + total) % total);
  }

  /** Navigates to the next image */
  nextImage(): void {
    const total = this.allImageUrls().length;
    if (total <= 1) return;
    this.activeImageIndex.update(i => (i + 1) % total);
  }

  /** Jumps to a specific image by index */
  goToImage(index: number): void {
    this.activeImageIndex.set(index);
  }

  /** Opens the full-screen lightbox */
  openLightbox(): void {
    if (this.allImageUrls().length > 0) {
      this.lightboxOpen.set(true);
    }
  }

  /** Closes the full-screen lightbox */
  closeLightbox(): void {
    this.lightboxOpen.set(false);
  }

  //#endregion

  //#region Form Methods

  private buildForm(product: Product): void {
    const groupControls: Record<string, FormArray<FormControl<boolean>>> = {};
    const groups = product.modifierGroups ?? [];
    for (const group of groups) {
      const checkboxes = group.extras.map(() => new FormControl(false, { nonNullable: true }));
      groupControls[String(group.id)] = this.fb.array(checkboxes) as FormArray<FormControl<boolean>>;
    }

    const groupsForm = this.fb.group<Record<string, FormArray<FormControl<boolean>>>>(groupControls, {
      validators: [kioskModifierGroupsValidator(groups)],
    });

    this.form = this.fb.group<DetailForm>({
      sizeId:   new FormControl<number | null>(product.sizes[0]?.id ?? null),
      groups:   groupsForm,
      quantity: new FormControl(1, { nonNullable: true }),
      notes:    new FormControl('', { nonNullable: true }),
    });

    this.form.valueChanges.subscribe(() => this.updatePreview());
  }

  private updatePreview(): void {
    const product = this.product();
    if (!product) return;

    const size = product.sizes.find(s => s.id === this.form.controls.sizeId.value);
    const selectedExtras = this.collectSelectedExtras(product);

    const unit = calcUnitPriceCents(product, size, selectedExtras);
    const quantity = this.form.controls.quantity.value ?? 1;
    this.previewPriceCents.set(unit * quantity);
  }

  /** Returns the flat list of currently-ticked extras across every group */
  private collectSelectedExtras(product: Product): ProductExtra[] {
    const selected: ProductExtra[] = [];
    const groups = product.modifierGroups ?? [];
    for (const group of groups) {
      const arr = this.groupArray(group.id);
      if (!arr) continue;
      group.extras.forEach((extra, i) => {
        if (arr.controls[i]?.value) selected.push(extra);
      });
    }
    return selected;
  }

  //#endregion

  //#region Accessors

  groupArray(groupId: number): FormArray<FormControl<boolean>> | undefined {
    return this.form.controls.groups.controls[String(groupId)];
  }

  selectedCount(groupId: number): number {
    const arr = this.groupArray(groupId);
    if (!arr) return 0;
    return arr.controls.reduce((n, c) => n + (c.value ? 1 : 0), 0);
  }

  canSelectMore(group: ProductModifierGroup): boolean {
    if (group.maxSelectable <= 0) return true;
    return this.selectedCount(group.id) < group.maxSelectable;
  }

  groupRuleLabel(group: ProductModifierGroup): string {
    if (group.maxSelectable === 1 && group.isRequired) return 'Elige 1 (obligatorio)';
    if (group.maxSelectable === 1) return 'Elige 1';
    if (group.isRequired && group.minSelectable > 0 && group.maxSelectable > 0) {
      return `Elige entre ${group.minSelectable} y ${group.maxSelectable} (obligatorio)`;
    }
    if (group.isRequired) return 'Obligatorio';
    if (group.maxSelectable > 0 && group.minSelectable > 0) {
      return `Elige entre ${group.minSelectable} y ${group.maxSelectable}`;
    }
    if (group.maxSelectable > 0) return `Elige hasta ${group.maxSelectable}`;
    if (group.minSelectable > 0) return `Elige al menos ${group.minSelectable}`;
    return 'Opcional';
  }

  groupErrorLabel(group: ProductModifierGroup): string | null {
    const errors = this.form.controls.groups.errors?.['modifierGroups'] as
      | Record<string, { min?: number; max?: number; required?: boolean }>
      | undefined;
    const err = errors?.[String(group.id)];
    if (!err) return null;
    if (err.required) return 'Selecciona al menos uno';
    if (err.min !== undefined) return `Debes elegir al menos ${err.min}`;
    if (err.max !== undefined) return `Máximo ${err.max} selecciones`;
    return null;
  }

  //#endregion

  //#region Cart Methods

  async onAddToCart(): Promise<void> {
    const product = this.product();
    if (!product || this.form.invalid) return;

    const size: ProductSize | undefined = product.sizes.find(
      s => s.id === this.form.controls.sizeId.value,
    );
    const selectedExtras = this.collectSelectedExtras(product);
    const quantity = this.form.controls.quantity.value ?? 1;
    const notes = this.form.controls.notes.value?.trim() || undefined;

    for (let i = 0; i < quantity; i++) {
      await this.cartService.addItem(product, size, selectedExtras, notes);
    }

    this.router.navigate(['/kiosk/catalog']);
  }

  goBack(): void {
    this.router.navigate(['/kiosk/catalog']);
  }

  //#endregion

}
