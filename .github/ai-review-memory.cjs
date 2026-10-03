const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { MODEL } = require("./ai-review-presentation.cjs");
const { contentKey } = require("./ai-review-context.cjs");
const TTL_MS = 24 * 60 * 60 * 1000;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function memoryIdentity(plan, instructions) {
  return hash(
    JSON.stringify({
      version: 2,
      provider: "groq",
      model: MODEL,
      base: plan.base,
      intent: plan.intent,
      limits: plan.limits,
      instructions,
      implementation: hash(
        ["chunks", "selection", "context", "memory", "provider"]
          .map((name) => fs.readFileSync(path.join(__dirname, `ai-review-${name}.cjs`), "utf8"))
          .join("\n"),
      ),
    }),
  );
}

function createMemory({ directory, identity, apiKey, now = Date.now }) {
  const file = (part) => path.join(directory, `${contentKey(part)}.json`);
  const signature = (payload) =>
    crypto.createHmac("sha256", apiKey).update(JSON.stringify(payload)).digest("hex");
  return {
    get(part) {
      try {
        const target = file(part);
        if (fs.statSync(target).size > 64000) return null;
        const entry = JSON.parse(fs.readFileSync(target, "utf8"));
        const payload = entry.payload;
        if (
          payload.identity !== identity ||
          payload.chunk !== contentKey(part) ||
          !Number.isFinite(payload.createdAt) ||
          payload.createdAt > now() ||
          now() - payload.createdAt > TTL_MS ||
          !/^[a-f0-9]{64}$/.test(entry.signature ?? "")
        )
          return null;
        if (
          !crypto.timingSafeEqual(
            Buffer.from(entry.signature, "hex"),
            Buffer.from(signature(payload), "hex"),
          )
        )
          return null;
        const assessment = payload.assessment;
        const findings = assessment.findings.map(({ anchorIndex, ...finding }) => {
          const anchor = part.anchors[anchorIndex];
          if (!anchor) throw new Error("Coordenada ya no disponible.");
          const [side, line] = anchor.split(":");
          return { ...finding, side, line: Number(line) };
        });
        return { ...assessment, findings };
      } catch {
        return null;
      }
    },
    set(part, assessment) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const payload = {
        identity,
        chunk: contentKey(part),
        createdAt: now(),
        assessment: {
          ...assessment,
          findings: assessment.findings.map(({ side, line, ...finding }) => {
            const anchorIndex = part.anchors.indexOf(`${side}:${line}`);
            if (anchorIndex < 0) throw new Error("Hallazgo fuera del bloque.");
            return { ...finding, anchorIndex };
          }),
        },
      };
      const data = JSON.stringify({ payload, signature: signature(payload) });
      const target = file(part);
      fs.writeFileSync(`${target}.tmp`, data, { mode: 0o600 });
      fs.renameSync(`${target}.tmp`, target);
    },
  };
}

module.exports = { TTL_MS, memoryIdentity, createMemory };
