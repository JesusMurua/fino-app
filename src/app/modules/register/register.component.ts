import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { environment } from '../../../environments/environment';
import { RegisterRequest } from '../../core/models';
import { codeToId, MACRO_CATEGORY_LABELS, MacroCategoryCode } from '../../core/enums';
import { AuthService } from '../../core/services/auth.service';
import { RegistrationIntent, parseRegistrationIntent } from '../../core/utils/registration.utils';

/** Icon used next to each macro category in the read-only badge (landing-driven flow) */
const MACRO_BADGE_ICON: Record<MacroCategoryCode, string> = {
  [MacroCategoryCode.FoodBeverage]: '🍽️',
  [MacroCategoryCode.QuickService]: '☕',
  [MacroCategoryCode.Retail]:       '🛒',
  [MacroCategoryCode.Services]:     '🛠️',
};

/** Typed error surfaced to the template — avoids substring matching on messages */
type RegisterErrorCode = 'email_taken' | 'invalid_giro' | 'generic' | null;

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

  //#region Injections

  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  //#endregion

  //#region State

  readonly isLoading = signal(false);
  readonly errorCode = signal<RegisterErrorCode>(null);

  /**
   * Parsed intent from the landing handshake — null until ngOnInit resolves it.
   * When the URL carries an invalid giro slug, `parseRegistrationIntent` throws
   * and `intent` stays null while `errorCode` is set to `'invalid_giro'`.
   */
  private intent: RegistrationIntent | null = null;

  /** Whether the landing provided a `?giro=` — drives badge vs dropdown */
  readonly hasGiroFromUrl = signal(false);

  /** Badge display info for the pre-selected macro category */
  readonly giroBadge = computed(() => {
    if (!this.hasGiroFromUrl()) return null;
    const id = this.form.getRawValue().primaryMacroCategoryId
      ?? this.intent?.primaryMacroCategoryCode ?? null;
    if (id === null) return null;
    return {
      icon:  MACRO_BADGE_ICON[id],
      // MACRO_CATEGORY_LABELS stays keyed by MacroCategoryType until B4
      // cleanup — translate the canonical code to the numeric id here.
      label: MACRO_CATEGORY_LABELS[codeToId(id)],
    };
  });

  /**
   * Dropdown options when the landing did not pre-select a giro.
   * The 4 macro categories defined in `.claude/business-rules-matrix.md`.
   */
  readonly businessTypeOptions = [
    { label: 'Restaurantes y Bares',     value: MacroCategoryCode.FoodBeverage },
    { label: 'Comida Rápida y Cafés',   value: MacroCategoryCode.QuickService },
    { label: 'Tiendas y Comercios',      value: MacroCategoryCode.Retail },
    { label: 'Servicios Especializados', value: MacroCategoryCode.Services },
  ];

  /** Landing URL for the "back to plans" link */
  readonly landingUrl = environment.landingUrl;

  readonly form = this.fb.group({
    businessName:           ['', Validators.required],
    ownerName:              ['', Validators.required],
    email:                  ['', [Validators.required, Validators.email]],
    password:               ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword:        ['', Validators.required],
    primaryMacroCategoryId: this.fb.control<MacroCategoryCode | null>(null, Validators.required),
  }, { validators: passwordMatchValidator });

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    try {
      this.intent = parseRegistrationIntent(this.route.snapshot.queryParams);
    } catch {
      // Fail-fast: unknown giro slug from the landing — block the form
      // and surface an error. The user must go back to the landing and
      // pick a valid giro.
      this.errorCode.set('invalid_giro');
      return;
    }
    this.hasGiroFromUrl.set(this.intent.giroSlug !== null);
    if (this.intent.primaryMacroCategoryCode !== null) {
      this.form.patchValue({ primaryMacroCategoryId: this.intent.primaryMacroCategoryCode });
    }
  }

  //#endregion

  //#region Template helpers

  /** Returns true if a form control is invalid and touched */
  isInvalidField(name: string): boolean {
    const control = this.form.get(name);
    return !!(control?.invalid && control?.touched);
  }

  /** Returns true if password mismatch error is active */
  get passwordMismatch(): boolean {
    return this.form.hasError('passwordMismatch') && !!this.form.get('confirmPassword')?.touched;
  }

  /** Human-readable error message for the template */
  readonly errorMessage = computed(() => {
    switch (this.errorCode()) {
      case 'email_taken':  return 'Este correo ya tiene una cuenta.';
      case 'invalid_giro': return 'El giro indicado en la URL no es válido. Regresa a la página de planes y elige uno.';
      case 'generic':      return 'Error al crear la cuenta. Intenta de nuevo.';
      default:             return '';
    }
  });

  //#endregion

  //#region Submit

  /**
   * Orchestrates the registration flow:
   *   1. validate the form
   *   2. build a typed RegisterRequest
   *   3. delegate to AuthService.register()
   *   4. persist the pending plan for the onboarding checkout step
   *   5. navigate to the onboarding wizard
   */
  async submit(): Promise<void> {
    if (this.form.invalid || this.intent === null) {
      this.form.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorCode.set(null);

    const { businessName, ownerName, email, password, primaryMacroCategoryId } = this.form.getRawValue();
    // Validators.required guarantees the macro is set at this point;
    // if the URL handshake brought one, it was patched into the form during ngOnInit.
    const resolvedMacroCode = primaryMacroCategoryId ?? this.intent.primaryMacroCategoryCode;
    if (resolvedMacroCode === null) {
      this.isLoading.set(false);
      this.form.markAllAsTouched();
      return;
    }

    const payload: RegisterRequest = {
      businessName:           businessName!.trim(),
      ownerName:              ownerName!.trim(),
      email:                  email!.trim(),
      password:               password!,
      // F5: RegisterRequest wire shape is numeric; translate from code.
      primaryMacroCategoryId: codeToId(resolvedMacroCode),
      planTypeId:             this.intent.planTypeId,
      countryCode:            this.intent.countryCode,
      timeZoneId:             Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    try {
      await firstValueFrom(this.authService.register(payload));
      this.persistPendingPlan();
      this.router.navigate(['/onboarding']);
    } catch (error) {
      this.errorCode.set(this.mapError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion

  //#region Private helpers

  /**
   * Persists the pending plan slug so the onboarding wizard's step 4
   * (Stripe checkout) can resume the user's original intent.
   *
   * Keyed by the active branch id written by `handleLoginSuccess` — the
   * signal is always up to date here because `register()` runs its
   * success side-effects synchronously before the observable emits.
   * When the branch id is somehow 0, we skip persistence and warn so
   * the failure is visible in the console rather than silently dropped.
   */
  private persistPendingPlan(): void {
    if (!this.intent?.planSlug) return;
    const branchId = this.authService.branchId;
    if (branchId <= 0) {
      console.warn('[Register] Cannot persist pending plan — no active branch id.');
      return;
    }
    localStorage.setItem(`pending-plan-${branchId}`, this.intent.planSlug);
  }

  /**
   * Maps an HTTP error to a typed error code. Status 409 → email taken,
   * everything else → generic. No substring matching on messages.
   */
  private mapError(error: unknown): RegisterErrorCode {
    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'email_taken';
    }
    return 'generic';
  }

  //#endregion

}
