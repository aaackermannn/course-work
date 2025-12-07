import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { AccountComponent } from './account.component';

describe('AccountComponent', () => {
  let component: AccountComponent;
  let fixture: ComponentFixture<AccountComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountComponent, FormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should return correct canRegister value', () => {
    expect(component.canRegister).toBe(false);

    component.email = 'test@test.com';
    component.password = 'password';
    component.confirmPassword = 'password';
    expect(component.canRegister).toBe(true);

    component.confirmPassword = 'different';
    expect(component.canRegister).toBe(false);

    component.email = '';
    expect(component.canRegister).toBe(false);
  });
});
