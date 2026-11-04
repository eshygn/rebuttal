import { describe, expect, it } from "vitest";
import { add, clampMinor, formatMoney, fromPayPal, parseMinor, percentOf, sub, toPayPal, toPayPalValue } from "@/lib/money";

describe("money", () => {
  it("parses PayPal decimal strings into integer minor units", () => {
    expect(parseMinor("84.00", "USD")).toBe(8400);
    expect(parseMinor("84.5", "USD")).toBe(8450);
    expect(parseMinor("84", "USD")).toBe(8400);
    expect(parseMinor("0.07", "USD")).toBe(7);
    expect(parseMinor("1500", "JPY")).toBe(1500);
    expect(parseMinor("-12.30", "USD")).toBe(-1230);
  });

  it("does not round silently and rejects malformed input", () => {
    expect(() => parseMinor("1.005", "USD")).toThrow();
    expect(() => parseMinor("1,084.50", "USD")).toThrow();
    expect(() => parseMinor("abc", "USD")).toThrow();
    expect(parseMinor("1.500", "USD")).toBe(150); // trailing zeros are fine
  });

  it("formats minor units the way PayPal expects", () => {
    expect(toPayPalValue(8400, "USD")).toBe("84.00");
    expect(toPayPalValue(5, "USD")).toBe("0.05");
    expect(toPayPalValue(-1230, "USD")).toBe("-12.30");
    expect(toPayPalValue(1500, "JPY")).toBe("1500");
    expect(() => toPayPalValue(1.5, "USD")).toThrow();
  });

  it("round-trips through PayPal amounts", () => {
    for (const v of ["0.01", "19.99", "84.00", "123456.78"]) {
      expect(toPayPal(fromPayPal({ currency_code: "USD", value: v }))).toEqual({ currency_code: "USD", value: v });
    }
  });

  it("always shows the currency", () => {
    expect(formatMoney({ minor: 8400, currency: "USD" })).toBe("$84.00 USD");
    expect(formatMoney({ minor: 123456789, currency: "USD" })).toBe("$1,234,567.89 USD");
    expect(formatMoney({ minor: -2600, currency: "GBP" })).toBe("−£26.00 GBP");
  });

  it("takes percentages in basis points with half-up rounding", () => {
    expect(percentOf(6500, 4000)).toBe(2600); // 40% of $65.00
    expect(percentOf(999, 5000)).toBe(500); // 499.5 rounds up
    expect(percentOf(999, 3333)).toBe(333); // 332.967 → 333
    expect(percentOf(1, 4900)).toBe(0);
    expect(() => percentOf(100, 33.3)).toThrow();
  });

  it("clamps and adds without mixing currencies", () => {
    expect(clampMinor(9000, 1, 8399)).toBe(8399);
    expect(add({ minor: 100, currency: "USD" }, { minor: 250, currency: "USD" })).toEqual({ minor: 350, currency: "USD" });
    expect(sub({ minor: 6500, currency: "USD" }, { minor: 2600, currency: "USD" }).minor).toBe(3900);
    expect(() => add({ minor: 1, currency: "USD" }, { minor: 1, currency: "EUR" })).toThrow();
  });
});
