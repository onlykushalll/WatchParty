export interface PIControllerConfig {
  kp: number; // default 0.05
  ki: number; // default 0.005
  minRate: number; // default 0.95
  maxRate: number; // default 1.05
  deadbandSec: number; // default 0.1s (100ms)
  hardSeekSec: number; // default 1.0s (1000ms)
}

export interface PIControllerOutput {
  slewRate: number;
  action: "NONE" | "SLEW" | "SEEK";
  errorSec: number;
}

export class PISlewingController {
  private integralAccumulator: number = 0;
  private config: PIControllerConfig;

  constructor(config?: Partial<PIControllerConfig>) {
    this.config = {
      kp: 0.05,
      ki: 0.005,
      minRate: 0.95,
      maxRate: 1.05,
      deadbandSec: 0.1,
      hardSeekSec: 1.0,
      ...config,
    };
  }

  public compute(
    expectedTimeSec: number,
    actualTimeSec: number,
    dtSec: number,
    baseRate: number = 1.0
  ): PIControllerOutput {
    const errorSec = expectedTimeSec - actualTimeSec;
    const absErrorSec = Math.abs(errorSec);

    // Tier 3: Hard Seek threshold (> 1.0s)
    if (absErrorSec > this.config.hardSeekSec) {
      this.reset();
      return { slewRate: baseRate, action: "SEEK", errorSec };
    }

    // Tier 1: Deadband zone (<= 0.1s / 100ms)
    if (absErrorSec <= this.config.deadbandSec) {
      this.integralAccumulator = 0;
      return { slewRate: baseRate, action: "NONE", errorSec };
    }

    // Tier 2: PI Slewing zone (0.1s < |e_k| <= 1.0s)
    const dt = Math.max(0.01, dtSec);
    const potentialIntegral = this.integralAccumulator + errorSec * dt;
    const unconstrainedRate =
      baseRate + this.config.kp * errorSec + this.config.ki * potentialIntegral;

    const lowerBound = this.config.minRate * baseRate;
    const upperBound = this.config.maxRate * baseRate;

    const clampedRate = Math.min(
      Math.max(unconstrainedRate, lowerBound),
      upperBound
    );

    // Anti-Windup Guard: Only update integral if unconstrained rate is within bounds
    if (unconstrainedRate === clampedRate) {
      this.integralAccumulator = potentialIntegral;
    }

    return { slewRate: clampedRate, action: "SLEW", errorSec };
  }

  public getIntegral(): number {
    return this.integralAccumulator;
  }

  public reset(): void {
    this.integralAccumulator = 0;
  }
}

/**
 * Utility helper to compute expected room playhead position
 */
export function computeExpectedPlayhead(
  roomBaseTimeSec: number,
  lastChangedAtMs: number,
  clientNowMs: number,
  clockOffsetMs: number,
  playbackRate: number = 1.0,
  isPlaying: boolean = true
): number {
  if (!isPlaying) return roomBaseTimeSec;
  const serverNowMs = clientNowMs + clockOffsetMs;
  const elapsedSec = Math.max(0, (serverNowMs - lastChangedAtMs) / 1000);
  return roomBaseTimeSec + elapsedSec * playbackRate;
}
