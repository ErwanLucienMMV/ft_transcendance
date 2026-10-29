import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, register } from 'prom-client';
import type {
  CounterConfiguration,
  GaugeConfiguration,
  HistogramConfiguration,
} from 'prom-client';

/** All application instruments share the registry exposed by both scrape URLs. */
@Injectable()
export class MetricsService {
  readonly registry = register;

  counter<T extends string>(config: CounterConfiguration<T>): Counter<T> {
    const existing = this.registry.getSingleMetric(config.name);
    if (existing) {
      if (!(existing instanceof Counter))
        throw new Error(`Metric ${config.name} is already a different type`);
      return existing as Counter<T>;
    }
    return new Counter<T>({ ...config, registers: [this.registry] });
  }

  gauge<T extends string>(config: GaugeConfiguration<T>): Gauge<T> {
    const existing = this.registry.getSingleMetric(config.name);
    if (existing) {
      if (!(existing instanceof Gauge))
        throw new Error(`Metric ${config.name} is already a different type`);
      // Rebuilt providers must not retain a collector bound to closed resources.
      if (config.collect) Object.assign(existing, { collect: config.collect });
      return existing as Gauge<T>;
    }
    return new Gauge<T>({ ...config, registers: [this.registry] });
  }

  histogram<T extends string>(config: HistogramConfiguration<T>): Histogram<T> {
    const existing = this.registry.getSingleMetric(config.name);
    if (existing) {
      if (!(existing instanceof Histogram))
        throw new Error(`Metric ${config.name} is already a different type`);
      return existing as Histogram<T>;
    }
    return new Histogram<T>({ ...config, registers: [this.registry] });
  }
}
