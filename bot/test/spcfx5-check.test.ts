import { describe, it, expect } from "vitest";
import { judgeMatch, describeHits } from "../src/spcfx5-check";

describe("judgeMatch", () => {
  it("« existe » si le symbole interrogé apparaît exactement dans les résultats", () => {
    const hits = [{ symbol: "DAX", instrument_name: "DAX Index" }];
    expect(judgeMatch("DAX", hits)).toBe("existe");
  });

  it("est insensible à la casse et aux espaces", () => {
    const hits = [{ symbol: "dax " }];
    expect(judgeMatch(" DAX", hits)).toBe("existe");
  });

  it("« n'existe pas » si aucun résultat", () => {
    expect(judgeMatch("GDAXI", [])).toBe("n'existe pas");
  });

  it("« autre symbole trouvé » si des résultats existent mais aucun ne correspond exactement", () => {
    const hits = [{ symbol: "GER40", instrument_name: "Germany 40" }];
    expect(judgeMatch("GDAXI", hits)).toBe("autre symbole trouvé");
  });
});

describe("describeHits", () => {
  it("renvoie un tiret si aucun résultat", () => {
    expect(describeHits([])).toBe("—");
  });

  it("liste les résultats avec bourse et nom, limités à N", () => {
    const hits = [
      { symbol: "NESN", mic_code: "XVTX", instrument_name: "Nestlé SA" },
      { symbol: "NESN", mic_code: "XSWX", instrument_name: "Nestlé SA" },
      { symbol: "0NES", mic_code: "XLON", instrument_name: "Nestlé SA GDR" },
      { symbol: "EXTRA", instrument_name: "Ne doit pas apparaître (limite 3)" },
    ];
    const out = describeHits(hits, 3);
    expect(out).toContain("NESN:XVTX (Nestlé SA)");
    expect(out).toContain("0NES:XLON (Nestlé SA GDR)");
    expect(out).not.toContain("EXTRA");
  });

  it("retombe sur instrument_type si le nom est absent", () => {
    const out = describeHits([{ symbol: "XPT/USD", instrument_type: "Physical Currency" }]);
    expect(out).toBe("XPT/USD (Physical Currency)");
  });
});
