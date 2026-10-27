import { describe, expect, it } from "vitest";
import {
  breakEvenWinRate,
  expectancy,
  fibExtension,
  fibRetracement,
  losingStreakProbability,
  lossesUntilDrawdown,
  positionSize,
  requiredMargin,
  riskAmount,
  simulateTrades,
  targetPrice,
} from "../shared/calculators";

describe("trading calculators", () => {
  it("computes the risk amount from budget and percent", () => {
    expect(riskAmount(10000, 1)).toBe(100);
    expect(riskAmount(5000, 2.5)).toBe(125);
    expect(lossesUntilDrawdown(1)).toBe(50);
    expect(lossesUntilDrawdown(2)).toBe(25);
    expect(lossesUntilDrawdown(3)).toBe(17);
    expect(lossesUntilDrawdown(0)).toBe(Infinity);
  });

  it("sizes positions like the source examples", () => {
    expect(positionSize(100, 135.5, 130)).toBeCloseTo(18.18, 2);
    expect(positionSize(100, 153.52, 150.52)).toBeCloseTo(33.33, 2);
    expect(positionSize(100, 130, 135.5)).toBeCloseTo(18.18, 2); // short
    expect(positionSize(100, 100, 100)).toBe(0);
  });

  it("computes expectancy and break-even", () => {
    expect(expectancy(0.3, 3.8)).toBeCloseTo(0.44);
    expect(expectancy(0.3, 3.8) * 100).toBeCloseTo(44);
    expect(breakEvenWinRate(4)).toBeCloseTo(0.2);
    expect(expectancy(breakEvenWinRate(3.8), 3.8)).toBeCloseTo(0);
  });

  it("projects R targets for long and short", () => {
    expect(targetPrice(135.5, 130, 4)).toBeCloseTo(157.5);
    expect(targetPrice(100, 105, 2)).toBeCloseTo(90);
  });

  it("computes Fibonacci levels", () => {
    const ret = fibRetracement(100, 150);
    expect(ret.find((l) => l.ratio === 0.618)!.price).toBeCloseTo(119.1);
    expect(ret.find((l) => l.ratio === 0)!.price).toBe(150);
    const ext = fibExtension(100, 150, 120);
    expect(ext.map((l) => l.price)).toEqual([170, 200.9, 250.9, 300.9].map((v) => expect.closeTo(v, 6)));
    // Down impulse projects downwards.
    expect(fibExtension(150, 100, 130)[1].price).toBeCloseTo(49.1);
  });

  it("computes margin", () => {
    expect(requiredMargin(29000, 20)).toBe(1450);
  });

  it("simulates reproducible trade series", () => {
    const a = simulateTrades(50, 0.3, 3.8, 1, 7);
    const b = simulateTrades(50, 0.3, 3.8, 1, 7);
    expect(a).toEqual(b);
    expect(a.equity).toHaveLength(51);
    expect(a.equity[50]).toBeCloseTo(a.wins * 3.8 - (50 - a.wins));
    expect(simulateTrades(10, 0, 2, 1, 1).longestLosingStreak).toBe(10);
  });

  it("estimates losing-streak probabilities", () => {
    expect(losingStreakProbability(1, 1, 0.3)).toBeCloseTo(0.7);
    expect(losingStreakProbability(2, 2, 0.3)).toBeCloseTo(0.49);
    expect(losingStreakProbability(2, 3, 0.5)).toBeCloseTo(0.375);
  });
});
