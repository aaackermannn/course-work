import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface Note {
  id?: string;
  uid?: string;
  type: 'match' | 'teammate';
  targetId: string;
  text: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class NotesService {
  private readonly http = inject(HttpClient);

  addNote(targetId: string, type: Note['type'], text: string): Promise<void> {
    return this.http
      .post('/api/notes', { targetId, type, text }, { withCredentials: true })
      .toPromise()
      .then(() => void 0);
  }

  updateNote(id: string, text: string): Promise<void> {
    return this.http
      .patch(`/api/notes/${id}`, { text }, { withCredentials: true })
      .toPromise()
      .then(() => void 0);
  }

  deleteNote(id: string): Promise<void> {
    return this.http
      .delete(`/api/notes/${id}`, { withCredentials: true })
      .toPromise()
      .then(() => void 0);
  }

  listNotes(targetId?: string, type?: Note['type']): Observable<Note[]> {
    const params: any = {};
    if (targetId) params.targetId = targetId;
    if (type) params.type = type;
    return this.http
      .get<{ items: Note[] }>('/api/notes', {
        params,
        withCredentials: true,
      })
      .pipe(map((r) => r.items));
  }
}
