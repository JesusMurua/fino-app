import { Component, Input, OnInit, signal } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CheckboxModule } from 'primeng/checkbox';
import { RadioButtonModule } from 'primeng/radiobutton';
import { InputTextareaModule } from 'primeng/inputtextarea';

import { Product, ProductExtra, ProductSize, calcUnitPriceCents } from '../../../../core/models';
import { CartService } from '../../../../core/services/cart.service';
import { DatabaseService } from '../../../../core/services/database.service';
import { ProductService } from '../../../../core/services/product.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/** Reactive form shape for the kiosk product detail page */
interface DetailForm {
  sizeId:   FormControl<number | null>;
  extras:   FormArray<FormControl<boolean>>;
  quantity: FormControl<number>;
  notes:    FormControl<string>;
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
    const extrasControls = product.extras.map(() => new FormControl(false, { nonNullable: true }));

    this.form = this.fb.group<DetailForm>({
      sizeId:   new FormControl<number | null>(product.sizes[0]?.id ?? null),
      extras:   this.fb.array(extrasControls) as FormArray<FormControl<boolean>>,
      quantity: new FormControl(1, { nonNullable: true }),
      notes:    new FormControl('', { nonNullable: true }),
    });

    this.form.valueChanges.subscribe(() => this.updatePreview());
  }

  private updatePreview(): void {
    const product = this.product();
    if (!product) return;

    const { sizeId, extras } = this.form.getRawValue();
    const size = product.sizes.find(s => s.id === sizeId);
    const selectedExtras = product.extras.filter((_, i) => extras[i]);

    const unit = calcUnitPriceCents(product, size, selectedExtras);
    this.previewPriceCents.set(unit * (this.form.getRawValue().quantity ?? 1));
  }

  //#endregion

  //#region Accessors

  get extrasArray(): FormArray<FormControl<boolean>> {
    return this.form.controls.extras;
  }

  //#endregion

  //#region Cart Methods

  async onAddToCart(): Promise<void> {
    const product = this.product();
    if (!product || this.form.invalid) return;

    const { sizeId, extras, quantity, notes } = this.form.getRawValue();
    const size: ProductSize | undefined = product.sizes.find(s => s.id === sizeId);
    const selectedExtras: ProductExtra[] = product.extras.filter((_, i) => extras[i]);

    for (let i = 0; i < quantity; i++) {
      await this.cartService.addItem(product, size, selectedExtras, notes || undefined);
    }

    this.router.navigate(['/kiosk/catalog']);
  }

  goBack(): void {
    this.router.navigate(['/kiosk/catalog']);
  }

  //#endregion

}
