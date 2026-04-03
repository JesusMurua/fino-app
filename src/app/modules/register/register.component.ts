import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { environment } from '../../../environments/environment';
import { BusinessType, LoginResponse, PlanType } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';

/** Giro display info for the read-only badge */
const GIRO_BADGE_MAP: Record<string, { icon: string; label: string }> = {
  restaurant:  { icon: '🍽️', label: 'Restaurante' },
  cafe:        { icon: '☕',  label: 'Café' },
  bar:         { icon: '🍺',  label: 'Bar' },
  retail:      { icon: '🛒',  label: 'Abarrotes / Tienda' },
  foodtruck:   { icon: '🚚',  label: 'Food Truck' },
  'food-truck': { icon: '🚚',  label: 'Food Truck' },
  general:     { icon: '⚙️',  label: 'General' },
};

/** Custom validator: password fields must match */
function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password');
  const confirm = control.get('confirmPassword');
  if (password && confirm && password.value !== confirm.value) {
    return { passwordMismatch: true };
  }
  return null;
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterModule,
    DropdownModule,
    InputTextModule,
    PasswordModule,
  ],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent implements OnInit {

  //#region Properties

  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly isLoading = signal(false);
  readonly errorMessage = signal('');

  readonly businessTypeOptions = [
    { label: 'Restaurante',       value: BusinessType.Restaurant },
    { label: 'Cafe',              value: BusinessType.Cafe },
    { label: 'Bar',               value: BusinessType.Bar },
    { label: 'Abarrotes / Retail', value: BusinessType.Retail },
    { label: 'Food Truck',        value: BusinessType.FoodTruck },
    { label: 'General',           value: BusinessType.General },
  ];

  readonly form = this.fb.group({
    businessName:    ['', Validators.required],
    ownerName:       ['', Validators.required],
    email:           ['', [Validators.required, Validators.email]],
    password:        ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
    businessType:    [BusinessType.Restaurant, Validators.required],
  }, { validators: passwordMatchValidator });

  /** Giro param from URL — when set, shows badge instead of dropdown */
  readonly giroParam = signal<string | null>(null);

  /** Badge display info for the pre-selected giro */
  readonly giroBadgeInfo = computed(() => {
    const giro = this.giroParam();
    return giro ? (GIRO_BADGE_MAP[giro] ?? null) : null;
  });

  /** Landing URL for "go back" link */
  readonly landingUrl = environment.landingUrl;

  /** Pending plan from query param — stored for onboarding step 4 */
  private pendingPlan: string | null = null;

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;

    // Pre-select business type from ?giro=
    if (params['giro']) {
      this.giroParam.set(params['giro'].toLowerCase());
      const giroMap: Record<string, BusinessType> = {
        restaurant: BusinessType.Restaurant,
        cafe: BusinessType.Cafe,
        bar: BusinessType.Bar,
        retail: BusinessType.Retail,
        foodtruck: BusinessType.FoodTruck,
        'food-truck': BusinessType.FoodTruck,
        general: BusinessType.General,
      };
      const mapped = giroMap[params['giro'].toLowerCase()];
      if (mapped) {
        this.form.patchValue({ businessType: mapped });
      }
    }

    // Store pending plan for onboarding
    if (params['plan']) {
      this.pendingPlan = params['plan'].toLowerCase();
    }
  }

  //#endregion

  //#region Form Helpers

  /** Returns true if a form control is invalid and touched */
  isInvalidField(name: string): boolean {
    const control = this.form.get(name);
    return !!(control?.invalid && control?.touched);
  }

  /** Returns true if password mismatch error is active */
  get passwordMismatch(): boolean {
    return this.form.hasError('passwordMismatch') && !!this.form.get('confirmPassword')?.touched;
  }

  //#endregion

  //#region Submit

  /** Submits registration form to the API */
  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    const { businessName, ownerName, email, password, businessType } = this.form.getRawValue();

    /** Resolve planType: URL param → PlanType enum, default Free */
    const planMap: Record<string, PlanType> = {
      basic: PlanType.Basic,
      pro: PlanType.Pro,
      enterprise: PlanType.Enterprise,
    };
    const planType = (this.pendingPlan && planMap[this.pendingPlan]) ?? PlanType.Free;

    try {
      const response = await firstValueFrom(
        this.http.post<LoginResponse>(
          `${environment.apiUrl}/auth/register`,
          { businessName, ownerName, email, password, businessType, planType },
        ),
      );

      const user = this.authService.handleLoginSuccess(response);

      // Store pending plan for onboarding step 4
      if (this.pendingPlan && user.currentBranchId) {
        localStorage.setItem(`pending-plan-${user.currentBranchId}`, this.pendingPlan);
      }

      this.router.navigate(['/onboarding']);
    } catch (err: any) {
      if (err?.status === 409) {
        this.errorMessage.set('Este correo ya tiene una cuenta.');
      } else {
        this.errorMessage.set('Error al crear la cuenta. Intenta de nuevo.');
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion

}
