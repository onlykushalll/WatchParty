export interface ClockProbeSample {
  t0: number; // Client send timestamp (ms)
  t1: number; // Server receive timestamp (ms)
  t2: number; // Server transmit timestamp (ms)
  t3: number; // Client receive timestamp (ms)
  rtt: number; // Network Round-Trip Time (ms)
  offset: number; // Raw clock offset (ms)
}

export interface ClockSyncOptions {
  windowSize?: number; // Sliding window size (default 8)
  maxRttThresholdMs?: number; // Outlier threshold in ms (default 500)
  alpha?: number; // EMA smoothing factor (default 0.2)
}

export class ClockSyncEstimator {
  private window: ClockProbeSample[] = [];
  private windowSize: number;
  private maxRttThresholdMs: number;
  private alpha: number;
  private currentOffset: number = 0;
  private isInitialized: boolean = false;

  constructor(options?: ClockSyncOptions) {
    this.windowSize = options?.windowSize ?? 8;
    this.maxRttThresholdMs = options?.maxRttThresholdMs ?? 500;
    this.alpha = options?.alpha ?? 0.2;
  }

  public processProbe(
    t0: number,
    t1: number,
    t2: number,
    t3: number
  ): {
    offset: number;
    rtt: number;
    accepted: boolean;
    rawOffset: number;
  } {
    const serverProcessing = Math.max(0, t2 - t1);
    const rtt = Math.max(0, (t3 - t0) - serverProcessing);
    const rawOffset = ((t1 - t0) + (t2 - t3)) / 2;

    // Outlier rejection (> maxRttThresholdMs)
    if (rtt > this.maxRttThresholdMs) {
      return {
        offset: this.currentOffset,
        rtt,
        accepted: false,
        rawOffset,
      };
    }

    // Add accepted sample to sliding window
    this.window.push({ t0, t1, t2, t3, rtt, offset: rawOffset });
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }

    // Find sample with minimum RTT in current window
    const bestProbe = this.window.reduce(
      (min, p) => (p.rtt < min.rtt ? p : min),
      this.window[0]
    );

    // Exponential Moving Average (EMA) smoothing
    if (!this.isInitialized) {
      this.currentOffset = bestProbe.offset;
      this.isInitialized = true;
    } else {
      this.currentOffset =
        this.alpha * bestProbe.offset + (1 - this.alpha) * this.currentOffset;
    }

    return {
      offset: this.currentOffset,
      rtt: bestProbe.rtt,
      accepted: true,
      rawOffset,
    };
  }

  public getOffset(): number {
    return this.currentOffset;
  }

  public getMinRtt(): number {
    if (this.window.length === 0) return 0;
    return Math.min(...this.window.map((p) => p.rtt));
  }

  public getWindowSize(): number {
    return this.window.length;
  }

  public isReady(): boolean {
    return this.isInitialized;
  }

  public reset(): void {
    this.window = [];
    this.currentOffset = 0;
    this.isInitialized = false;
  }
}
