// Explicit inference double for tests of scoring, publication and memory.
// Behavioral verification is exercised separately through the real verifier.
const { sealFinding } = require("./ai-review-verification.cjs");
const { emptyUsage } = require("./ai-review-provider.cjs");
async function fixtureVerifier({ assessment, sha }) {
  return {
    calls: 0,
    usage: emptyUsage(),
    assessment: {
      ...assessment,
      findings: assessment.findings.map((f) => sealFinding(f, { fixture: true }, sha)),
    },
  };
}
module.exports = { fixtureVerifier };
