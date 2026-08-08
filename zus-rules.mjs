export const ZUS_RULE_VERSION = "PL-ZUS-2026.1";

export const ZUS_RULES = Object.freeze({
  version: ZUS_RULE_VERSION,
  validFrom: "2026-01",
  validTo: "2026-12",
  socialBaseGrosz: 565200,
  socialRatesBasisPoints: Object.freeze({
    pension: 1952,
    disability: 800,
    accident: 167,
    sickness: 245,
    labourFunds: 245,
  }),
  healthTiers: Object.freeze([
    Object.freeze({ code: "TO_60000", revenueToGrosz: 6000000, baseGrosz: 553718, contributionGrosz: 49835 }),
    Object.freeze({ code: "TO_300000", revenueToGrosz: 30000000, baseGrosz: 922864, contributionGrosz: 83058 }),
    Object.freeze({ code: "ABOVE_300000", revenueToGrosz: null, baseGrosz: 1661155, contributionGrosz: 149504 }),
  ]),
});
