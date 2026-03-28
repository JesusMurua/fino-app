import { Component, OnInit, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { environment } from '../../../environments/environment';
import { BusinessType, LoginResponse } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';

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

  /** Pending plan from query param — stored for onboarding step 4 */
  private pendingPlan: string | null = null;

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;

    // Pre-select business type from ?giro=
    if (params['giro']) {
      const giroMap: Record<string, BusinessType> = {
        restaurant: BusinessType.Restaurant,
        cafe: BusinessType.Cafe,
        bar: BusinessType.Bar,
        retail: BusinessType.Retail,
        foodtruck: BusinessType.FoodTruck,
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

    try {
      const response = await firstValueFrom(
        this.http.post<LoginResponse>(
          `${environment.apiUrl}/auth/register`,
          { businessName, ownerName, email, password, businessType },
        ),
      );

      const user = this.authService.handleLoginSuccess(response);

      // Store pending plan for onboarding step 4
      if (this.pendingPlan && user.branchId) {
        localStorage.setItem(`pending-plan-${user.branchId}`, this.pendingPlan);
      }

      this.router.navigate(['/admin']);
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
