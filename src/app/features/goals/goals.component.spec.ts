import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { GoalsComponent } from './goals.component';
describe('GoalsComponent', () => {
  let component: GoalsComponent;
  let fixture: ComponentFixture<GoalsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GoalsComponent, FormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(GoalsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should return correct canAdd value', () => {
    expect(component.canAdd).toBe(false);

    component.title = 'Test Goal';
    component.target = 50;
    expect(component.canAdd).toBe(true);

    component.title = '';
    expect(component.canAdd).toBe(false);

    component.title = 'Test Goal';
    component.target = 0;
    expect(component.canAdd).toBe(false);

    component.target = null;
    expect(component.canAdd).toBe(false);
  });

  it('should clear form', () => {
    component.title = 'Test';
    component.target = 50;
    component.metric = 'kd';

    component.clearForm();

    expect(component.title).toBe('');
    expect(component.target).toBe(null);
    expect(component.metric).toBe('winrate');
  });
});
