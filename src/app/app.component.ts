import { NgDompurifySanitizer } from '@tinkoff/ng-dompurify';
import {
  TuiRootModule,
  TuiDialogModule,
  TuiAlertModule,
  TUI_SANITIZER,
} from '@taiga-ui/core';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  Router,
  NavigationEnd,
} from '@angular/router';
import { YandexMetrikaService } from './services/yandex-metrika.service';
import { filter } from 'rxjs/operators';

@Component({
  standalone: true,
  imports: [
    CommonModule,
    TuiRootModule,
    TuiDialogModule,
    TuiAlertModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
  ],
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.less'],
  providers: [{ provide: TUI_SANITIZER, useClass: NgDompurifySanitizer }],
})
export class AppComponent implements OnInit {
  title = 'FaceItTrackIt';

  constructor(private router: Router, private metrika: YandexMetrikaService) {}

  ngOnInit(): void {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.metrika.trackPageView(event.urlAfterRedirects);
      });
  }
}
