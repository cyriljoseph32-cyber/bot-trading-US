import { describe, it, expect } from "vitest";
import { scoreSignal, bandFor } from "./scoring";
import type { Detection, SetupType } from "./detectors";

function dets(presentTypes: SetupType[], strength = 1): Detection[] {
  const all: SetupType[] = ["tendance", "momentum", "cassure", "retournement", "volume", "volatilite"];
  return all.map((type) => ({
    type,
    present: presentTypes.includes(type),
    strength: presentTypes.includes(type) ? strength : 0,
    detail: "",
  }));
}

describe("bandFor", () => {
  it("applique les bons seuils", () => {
    expect(bandFor(95)).toBe("tres_forte");
    expect(bandFor(70)).toBe("interessante");
    expect(bandFor(50)).toBe("surveillance");
    expect(bandFor(49)).toBe("ignorer");
  });
});

describe("scoreSignal", () => {
  it("tout présent + win-rate 100% + news positif → score très élevé", () => {
    const r = scoreSignal({ detections: dets(["tendance", "momentum", "cassure", "retournement", "volume", "volatilite"]), winRate: 1, newsSentiment: 1 });
    expect(r.score).toBe(100);
    expect(r.band).toBe("tres_forte");
  });

  it("rien présent + inconnus neutres → score bas (≈20)", () => {
    const r = scoreSignal({ detections: dets([]), winRate: null, newsSentiment: null });
    // technique 0 + win-rate neutre 12.5 + news neutre 7.5 = 20
    expect(r.score).toBe(20);
    expect(r.band).toBe("ignorer");
  });

  it("inclut une contribution par détecteur + win-rate + news", () => {
    const detections = dets(["tendance"]);
    const r = scoreSignal({ detections, winRate: 0.7 });
    expect(r.contributions).toHaveLength(detections.length + 2);
  });

  it("le score augmente avec un meilleur win-rate", () => {
    const base = dets(["tendance", "momentum"]);
    const low = scoreSignal({ detections: base, winRate: 0.2 }).score;
    const high = scoreSignal({ detections: base, winRate: 0.9 }).score;
    expect(high).toBeGreaterThan(low);
  });

  it("borne le score dans [0,100]", () => {
    const r = scoreSignal({ detections: dets([]), winRate: 0, newsSentiment: -1 });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
