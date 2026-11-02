import { Component, computed, input } from '@angular/core';
import { trCount } from '../core/i18n/i18n';
import { TranslocoPipe } from '@jsverse/transloco';

export interface RatingPoint {
  ratingBefore: number;
  ratingAfter: number;
  createdAt: string;
}

const WIDTH = 600;
const HEIGHT = 180;
const PAD = 8;

/**
 * Rating after each rated game, oldest on the left. Takes the history newest first, as the
 * API returns it.
 */
@Component({
  selector: 'app-elo-chart',
  imports: [TranslocoPipe],
  template: `
    @if (chart(); as c) {
      <figure>
        <svg
          [attr.viewBox]="'0 0 ' + width + ' ' + height"
          preserveAspectRatio="none"
          role="img"
          [attr.aria-label]="c.label"
        >
          <line
            class="grid"
            [attr.x1]="0"
            [attr.x2]="width"
            [attr.y1]="c.startY"
            [attr.y2]="c.startY"
          />
          <polygon class="area" [attr.points]="c.area" />
          <polyline class="line" [attr.points]="c.line" />
        </svg>
        <figcaption>
          <span>{{ 'shared.eloScale.low' | transloco: { value: c.low } }}</span>
          <span>{{ 'shared.eloScale.high' | transloco: { value: c.high } }}</span>
          <span>{{ 'shared.eloScale.now' | transloco: { value: c.now } }}</span>
        </figcaption>
      </figure>
    }
  `,
  styles: `
    figure {
      margin: 0;
      display: grid;
      gap: 6px;
    }
    svg {
      width: 100%;
      height: 160px;
      overflow: visible;
    }
    .grid {
      stroke: var(--border);
      stroke-dasharray: 4 4;
      vector-effect: non-scaling-stroke;
    }
    .area {
      fill: var(--accent-soft);
    }
    .line {
      fill: none;
      stroke: var(--accent);
      stroke-width: 2;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    figcaption {
      display: flex;
      justify-content: space-between;
      color: var(--muted);
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class EloChart {
  readonly history = input.required<RatingPoint[]>();
  readonly width = WIDTH;
  readonly height = HEIGHT;

  readonly chart = computed(() => {
    const history = [...this.history()].reverse();
    if (history.length === 0) return null;
    const values = [history[0].ratingBefore, ...history.map((point) => point.ratingAfter)];
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = Math.max(high - low, 20);
    const x = (index: number) => (index / (values.length - 1)) * WIDTH;
    const y = (value: number) => PAD + (1 - (value - low) / span) * (HEIGHT - 2 * PAD);
    const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
    const now = values.at(-1)!;
    return {
      line: points.join(' '),
      area: `0,${HEIGHT} ${points.join(' ')} ${WIDTH},${HEIGHT}`,
      startY: y(values[0]),
      low,
      high,
      now,
      label: trCount('shared.eloChart', history.length, { from: values[0], now, low, high }),
    };
  });
}
