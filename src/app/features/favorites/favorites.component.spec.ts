import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FavoritesComponent } from './favorites.component';

describe('FavoritesComponent', () => {
  let component: FavoritesComponent;
  let fixture: ComponentFixture<FavoritesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FavoritesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FavoritesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with default values', () => {
    expect(component.isAuthenticated).toBe(false);
    expect(component.loading).toBe(false);
    expect(component.profile).toBeUndefined();
    expect(component.favoritePlayers).toEqual([]);
    expect(component.comparisonPlayers).toEqual([]);
    expect(component.myProfile).toBe(null);
    expect(component.selectedFilter).toBe(20);
  });
});
