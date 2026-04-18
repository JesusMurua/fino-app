import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/** Supported mascot skins — matches the 4 macro categories + a neutral default. */
export type BrioSkin = 'default' | 'restaurant' | 'cafe' | 'retail' | 'services';

const HATS: Record<Exclude<BrioSkin, 'default'>, string> = {
  restaurant: `
    <circle cx="26" cy="13" r="5" fill="#ffffff"/>
    <circle cx="32" cy="10" r="7" fill="#ffffff"/>
    <circle cx="38" cy="13" r="5" fill="#ffffff"/>
    <rect x="22" y="15" width="20" height="11" rx="2" fill="#ffffff"/>
    <rect x="20" y="22" width="24" height="5" rx="1" fill="#e8e8e0"/>
  `,
  cafe: `
    <path d="M14 24 Q14 12 32 11 Q50 12 50 24" fill="#92400e"/>
    <ellipse cx="32" cy="24" rx="18" ry="4.5" fill="#78350f"/>
    <circle cx="32" cy="11" r="4" fill="#fbbf24"/>
  `,
  retail: `
    <path d="M16 26 Q16 15 32 14 Q48 15 48 26" fill="#2563eb"/>
    <path d="M12 27 L30 29 L30 31 L12 30 Z" fill="#1d4ed8"/>
    <circle cx="32" cy="14" r="2.5" fill="#93c5fd"/>
  `,
  services: `
    <path d="M13 30 Q13 15 32 13 Q51 15 51 30" fill="#fbbf24"/>
    <ellipse cx="32" cy="31" rx="21" ry="4" fill="#d97706"/>
    <rect x="29" y="13" width="6" height="4" rx="1" fill="#f59e0b"/>
  `,
};

const BODY_COLOR: Record<BrioSkin, string> = {
  default:    '#16A34A',
  restaurant: '#EF4444',
  cafe:       '#F59E0B',
  retail:     '#3B82F6',
  services:   '#8B5CF6',
};

/**
 * Brío mascot — simple SVG character that swaps accessory/body color per
 * business vertical. Used by the onboarding wizard to give the selection
 * step a friendly, contextual face.
 */
@Component({
  selector: 'app-brio-mascot',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="brio-mascot__frame" [attr.data-skin]="skin">
      <div class="brio-mascot__svg" [innerHTML]="renderedSvg"></div>
    </div>
  `,
  styles: [`
    :host {
      display: inline-flex;
    }
    .brio-mascot__frame {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .brio-mascot__svg {
      width: 100%;
      height: 100%;
      transition: transform 0.18s ease;
    }
    .brio-mascot__frame[data-changing='true'] .brio-mascot__svg {
      transform: scale(0.82);
    }
  `],
})
export class BrioMascotComponent {

  private _skin: BrioSkin = 'default';
  private _sanitized: SafeHtml;

  constructor(private readonly sanitizer: DomSanitizer) {
    this._sanitized = this.sanitizer.bypassSecurityTrustHtml(this.buildSvg('default'));
  }

  /** Active skin — setting it recomputes the SVG. */
  @Input() set skin(value: BrioSkin) {
    const next: BrioSkin = value ?? 'default';
    if (next === this._skin) return;
    this._skin = next;
    this._sanitized = this.sanitizer.bypassSecurityTrustHtml(this.buildSvg(next));
  }
  get skin(): BrioSkin {
    return this._skin;
  }

  get renderedSvg(): SafeHtml {
    return this._sanitized;
  }

  private buildSvg(skin: BrioSkin): string {
    const hat = skin === 'default' ? '' : HATS[skin];
    const body = BODY_COLOR[skin];
    return `
      <svg viewBox="0 0 64 68" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        ${hat}
        <circle cx="32" cy="48" r="20" fill="${body}"/>
        <circle cx="25" cy="44" r="3" fill="white" opacity="0.95"/>
        <circle cx="39" cy="44" r="3" fill="white" opacity="0.95"/>
        <circle cx="26" cy="43" r="1.2" fill="${body}"/>
        <circle cx="40" cy="43" r="1.2" fill="${body}"/>
        <path d="M25 53 Q32 58 39 53" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      </svg>
    `;
  }
}
