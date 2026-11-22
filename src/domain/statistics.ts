export interface Point2D {
  x: number;
  y: number;
}

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  predict: (x: number) => number;
  predictXForY: (targetY: number) => number | null;
}

export interface ExponentialSmoothingResult {
  alpha: number;
  smoothedSeries: number[];
  nextForecast: number;
  trendPerStep: number;
}

function round4(val: number): number {
  return Math.round((val + Number.EPSILON) * 10000) / 10000;
}

export class StatisticalEngine {
  static mean(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, v) => acc + v, 0);
    return round4(sum / values.length);
  }

  static median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return round4((sorted[mid - 1] + sorted[mid]) / 2);
    }
    return round4(sorted[mid]);
  }

  static standardDeviation(values: number[]): number {
    if (values.length <= 1) return 0;
    const avg = this.mean(values);
    const variance =
      values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length;
    return round4(Math.sqrt(variance));
  }

  static percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
    );
    return round4(sorted[idx]);
  }

  /**
   * Regressão Linear Simples pelo Método dos Mínimos Quadrados Ordinários (OLS)
   * y = slope * x + intercept
   */
  static ordinaryLeastSquares(points: Point2D[]): LinearRegressionResult {
    const n = points.length;
    if (n === 0) {
      return {
        slope: 0,
        intercept: 0,
        rSquared: 0,
        predict: () => 0,
        predictXForY: () => null,
      };
    }

    if (n === 1) {
      const y0 = points[0].y;
      return {
        slope: 0,
        intercept: round4(y0),
        rSquared: 1,
        predict: () => round4(y0),
        predictXForY: () => null,
      };
    }

    const meanX = points.reduce((acc, p) => acc + p.x, 0) / n;
    const meanY = points.reduce((acc, p) => acc + p.y, 0) / n;

    let numerator = 0;
    let denominatorX = 0;
    let totalSumSquaresY = 0;

    for (const p of points) {
      const dx = p.x - meanX;
      const dy = p.y - meanY;
      numerator += dx * dy;
      denominatorX += dx * dx;
      totalSumSquaresY += dy * dy;
    }

    const rawSlope = denominatorX === 0 ? 0 : numerator / denominatorX;
    const rawIntercept = meanY - rawSlope * meanX;

    let residualSumSquares = 0;
    for (const p of points) {
      const predictedY = rawSlope * p.x + rawIntercept;
      residualSumSquares += Math.pow(p.y - predictedY, 2);
    }

    const rSquared =
      totalSumSquaresY === 0
        ? 1
        : Math.max(0, Math.min(1, 1 - residualSumSquares / totalSumSquaresY));

    const slope = round4(rawSlope);
    const intercept = round4(rawIntercept);

    return {
      slope,
      intercept,
      rSquared: round4(rSquared),
      predict: (x: number) => round4(rawSlope * x + rawIntercept),
      predictXForY: (targetY: number) => {
        if (Math.abs(rawSlope) < 1e-9) return null;
        return round4((targetY - rawIntercept) / rawSlope);
      },
    };
  }

  /**
   * Suavização Exponencial Simples / Holt para séries temporais de degradação e falhas
   */
  static exponentialSmoothing(
    series: number[],
    alpha = 0.4
  ): ExponentialSmoothingResult {
    const clampedAlpha = Math.max(0.05, Math.min(0.95, alpha));
    if (series.length === 0) {
      return {
        alpha: clampedAlpha,
        smoothedSeries: [],
        nextForecast: 0,
        trendPerStep: 0,
      };
    }

    const smoothed: number[] = [round4(series[0])];
    for (let i = 1; i < series.length; i++) {
      const prev = smoothed[i - 1];
      const current = clampedAlpha * series[i] + (1 - clampedAlpha) * prev;
      smoothed.push(round4(current));
    }

    const lastSmoothed = smoothed[smoothed.length - 1];
    const firstSmoothed = smoothed[0];
    const steps = Math.max(1, smoothed.length - 1);
    const trendPerStep =
      smoothed.length > 1 ? round4((lastSmoothed - firstSmoothed) / steps) : 0;
    const nextForecast = round4(lastSmoothed + trendPerStep);

    return {
      alpha: clampedAlpha,
      smoothedSeries: smoothed,
      nextForecast,
      trendPerStep,
    };
  }
}
