import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { AnalyticsComponent } from './analytics.component';

describe('AnalyticsComponent', () => {
  let component: AnalyticsComponent;
  let fixture: ComponentFixture<AnalyticsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticsComponent, FormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have chart data', () => {
    expect(component.kdSeries).toBeDefined();
    expect(component.winrateSeries).toBeDefined();
    expect(component.hsSeries).toBeDefined();
  });

  it('should generate correct country flag URL', () => {
    const flagUrl = component.getCountryFlag('US');
    expect(flagUrl).toBe('https://flagcdn.com/w20/us.png');
  });
});
