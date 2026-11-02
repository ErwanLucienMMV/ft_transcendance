export interface ClockSample {
  clocks: { white: number; black: number };
  serverTime: string;
  clockStatus: string;
  turn: 'WHITE' | 'BLACK';
  status?: string;
}

/** Display projection only. Deadlines, increments and results always come from the server. */
export class GameClockSync {
  private offset: number | null = null;
  private latest = -Infinity;
  private sample: ClockSample | null = null;
  synchronize(
    sample: ClockSample,
    sent: number,
    received: number,
    processingMs: number,
    sampleAgeMs: number,
  ): boolean {
    const server = Date.parse(sample.serverTime);
    if (
      !Number.isFinite(server) ||
      !Number.isFinite(processingMs) ||
      !Number.isFinite(sampleAgeMs) ||
      processingMs < 0 ||
      sampleAgeMs < 0 ||
      sampleAgeMs > processingMs ||
      received < sent ||
      received - sent > 10000
    )
      return false;
    const network = Math.max(0, received - sent - processingMs) / 2;
    const offset = server + sampleAgeMs + network - received;
    if (!this.accept(sample)) return false;
    this.offset = offset;
    return true;
  }
  accept(sample: ClockSample): boolean {
    const timestamp = Date.parse(sample.serverTime);
    if (
      !Number.isFinite(timestamp) ||
      timestamp < this.latest ||
      !sample.clocks ||
      !Number.isFinite(sample.clocks.white) ||
      !Number.isFinite(sample.clocks.black) ||
      sample.clocks.white < 0 ||
      sample.clocks.black < 0 ||
      !['WHITE', 'BLACK'].includes(sample.turn)
    )
      return false;
    this.latest = timestamp;
    this.sample = sample;
    return true;
  }
  project(now: number): { white: number; black: number } | null {
    if (!this.sample) return null;
    const clocks = { ...this.sample.clocks };
    if (
      this.offset !== null &&
      this.sample.clockStatus === 'RUNNING' &&
      this.sample.status !== 'FINISHED'
    ) {
      const elapsed = Math.max(0, now + this.offset - this.latest);
      const side = this.sample.turn === 'WHITE' ? 'white' : 'black';
      clocks[side] = Math.max(0, clocks[side] - elapsed);
    }
    return clocks;
  }
  reset(): void {
    this.offset = null;
    this.latest = -Infinity;
    this.sample = null;
  }
}
