import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotesService, Note } from '../../services/notes.service';
import { AuthService } from '../../services/auth.service';
import { YandexMetrikaService } from '../../services/yandex-metrika.service';
import {
  TuiInputModule,
  TuiIslandModule,
  TuiPaginationModule,
  TuiTagModule,
  TuiBadgeModule,
} from '@taiga-ui/kit';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';

@Component({
  standalone: true,
  selector: 'app-notes',
  imports: [
    CommonModule,
    FormsModule,
    TuiInputModule,
    TuiButtonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiPaginationModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './notes.component.html',
  styleUrls: ['./notes.component.less'],
})
export class NotesComponent {
  private readonly notesService = inject(NotesService);
  private readonly authService = inject(AuthService);
  private readonly metrika = inject(YandexMetrikaService);

  loading = true;
  notes: Note[] = [];
  paged: Note[] = [];
  filter = '';
  page = 0;
  pageSize = 10;
  totalPages = 0;

  type: 'match' | 'teammate' = 'match';
  text = '';

  editingNote: Note | null = null;

  typeOptions = [
    { value: 'match', label: 'Матч' },
    { value: 'teammate', label: 'Тиммейт' },
  ];

  get isAuthenticated(): boolean {
    return !!this.authService.user();
  }

  get canAdd(): boolean {
    return Boolean(this.text.trim());
  }

  getPaginationArray(): number[] {
    const totalPages = this.totalPages;
    const currentPage = this.page;
    const pages: number[] = [];

    if (totalPages <= 7) {
      for (let i = 0; i < totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(0);

      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4);
        pages.push(-1);
        pages.push(totalPages - 1);
      } else if (currentPage >= totalPages - 4) {
        pages.push(-1);
        for (let i = totalPages - 5; i < totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(-1);
        pages.push(currentPage - 1, currentPage, currentPage + 1);
        pages.push(-1);
        pages.push(totalPages - 1);
      }
    }

    return pages;
  }

  ngOnInit(): void {
    this.checkAuth();
    if (this.isAuthenticated) {
      this.loadNotes();
    }
  }

  checkAuth(): void {
    this.authService.user$.subscribe((user) => {
      if (user) {
        this.loadNotes();
      } else {
        this.notes = [];
        this.paged = [];
        this.loading = false;
      }
    });
  }

  async loadNotes(): Promise<void> {
    try {
      this.loading = true;
      this.notesService.listNotes().subscribe((notes) => {
        this.notes = notes;
        this.applyPagingAndFilter();
        this.loading = false;
      });
    } catch (error) {
      this.loading = false;
    }
  }

  add(): void {
    if (this.editingNote) {
      this.updateNote();
    } else {
      this.createNote();
    }
  }

  async createNote(): Promise<void> {
    if (!this.canAdd) return;

    try {
      const targetId = 'general';
      await this.notesService.addNote(targetId, this.type, this.text.trim());
      this.clearForm();
      this.loadNotes();
      this.metrika.trackNoteCreation();
    } catch (error) {
      // Ошибка при создании заметки
    }
  }

  async updateNote(): Promise<void> {
    if (!this.editingNote || !this.canAdd) return;

    try {
      await this.notesService.updateNote(
        this.editingNote.id!,
        this.text.trim()
      );
      this.clearForm();
      this.loadNotes();
    } catch (error) {
      // Ошибка при обновлении заметки
    }
  }

  editNote(note: Note): void {
    this.editingNote = note;
    this.type = note.type;
    this.text = note.text;
  }

  async deleteNote(note: Note): Promise<void> {
    if (!note.id) {
      // Ошибка при удалении заметки без ID
      return;
    }
    if (confirm('Удалить эту заметку?')) {
      try {
        await this.notesService.deleteNote(note.id);
        this.loadNotes();
      } catch (error) {
        // Ошибка при удалении заметки
      }
    }
  }

  clearForm(): void {
    this.editingNote = null;
    this.type = 'match';
    this.text = '';
  }

  onFilter(value: string): void {
    this.filter = value;
    this.page = 0;
    this.applyPagingAndFilter();
  }

  clearFilter(): void {
    this.filter = '';
    this.page = 0;
    this.applyPagingAndFilter();
  }

  onSort(key: 'createdAt' | 'type'): void {
    // Сортировка отключена
  }

  private applyPagingAndFilter(): void {
    let arr = [...this.notes];

    if (this.filter) {
      const filterLower = this.filter.toLowerCase();
      arr = arr.filter((n) => n.text.toLowerCase().includes(filterLower));
    }

    this.totalPages = Math.ceil(arr.length / this.pageSize) || 1;
    const start = this.page * this.pageSize;
    this.paged = arr.slice(start, start + this.pageSize);
  }

  signIn(): void {
    // Google auth не используется в локальном варианте
  }
}
