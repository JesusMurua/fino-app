import { Component, EventEmitter, Input, Output } from '@angular/core';

import { Category } from '../../../../core/models';

@Component({
  selector: 'app-category-sidebar',
  standalone: true,
  templateUrl: './category-sidebar.component.html',
  styleUrl: './category-sidebar.component.scss',
})
export class CategorySidebarComponent {

  //#region Inputs & Outputs
  @Input() categories: Category[] = [];
  @Input() selectedCategoryId: number | null = null;
  @Output() categorySelected = new EventEmitter<number | null>();
  //#endregion

}
