// HGVS c. parsing — lifted verbatim from optiprime-front/src/Utils.js
// (parseHgvs / _HGVS_PATTERNS / _parseHgvsPos). Pure JS, no network, c.-notation only.
// classifyVariant() is added here to map a parsed variant onto the framework's
// variant-class → editing-modality lookup (Table 1, N1C guidelines).

const _HGVS_POS_STR = String.raw`[-*]?\d+(?:[+-]\d+)?`;

const _parseHgvsPos = (s) => {
  const m = s.match(/^([-*]?)(\d+)([+-]\d+)?$/);
  if (!m) throw new Error(`Invalid HGVS position: ${s}`);
  const [, prefix, num, intron] = m;
  const region = prefix === "-" ? "utr5" : prefix === "*" ? "utr3" : "cds";
  return {
    region,
    cdsOffset: parseInt(num, 10),
    intronOffset: intron ? parseInt(intron, 10) : 0,
  };
};

const _HGVS_PATTERNS = [
  {
    re: new RegExp(`^(${_HGVS_POS_STR})([A-Z])>([A-Z])$`, "i"),
    make: (m) => ({
      type: "sub",
      pos1: _parseHgvsPos(m[1]),
      pos2: null,
      ref: m[2].toUpperCase(),
      mut: m[3].toUpperCase(),
    }),
  },
  {
    re: new RegExp(`^(${_HGVS_POS_STR})_(${_HGVS_POS_STR})delins([ACGT]+)$`, "i"),
    make: (m) => ({
      type: "delins",
      pos1: _parseHgvsPos(m[1]),
      pos2: _parseHgvsPos(m[2]),
      ref: null,
      mut: m[3].toUpperCase(),
    }),
  },
  {
    re: new RegExp(`^(${_HGVS_POS_STR})delins([ACGT]+)$`, "i"),
    make: (m) => ({
      type: "delins",
      pos1: _parseHgvsPos(m[1]),
      pos2: null,
      ref: null,
      mut: m[2].toUpperCase(),
    }),
  },
  {
    re: new RegExp(`^(${_HGVS_POS_STR})_(${_HGVS_POS_STR})ins([ACGT]+)$`, "i"),
    make: (m) => ({
      type: "ins",
      pos1: _parseHgvsPos(m[1]),
      pos2: _parseHgvsPos(m[2]),
      ref: null,
      mut: m[3].toUpperCase(),
    }),
  },
  {
    re: new RegExp(`^(${_HGVS_POS_STR})_(${_HGVS_POS_STR})del([ACGT]*)$`, "i"),
    make: (m) => ({
      type: "del",
      pos1: _parseHgvsPos(m[1]),
      pos2: _parseHgvsPos(m[2]),
      ref: m[3] ? m[3].toUpperCase() : null,
      mut: "",
    }),
  },
  {
    re: new RegExp(`^(${_HGVS_POS_STR})del([ACGT]*)$`, "i"),
    make: (m) => ({
      type: "del",
      pos1: _parseHgvsPos(m[1]),
      pos2: null,
      ref: m[2] ? m[2].toUpperCase() : null,
      mut: "",
    }),
  },
  {
    re: new RegExp(`^(${_HGVS_POS_STR})_(${_HGVS_POS_STR})dup([ACGT]*)$`, "i"),
    make: (m) => ({
      type: "dup",
      pos1: _parseHgvsPos(m[1]),
      pos2: _parseHgvsPos(m[2]),
      ref: m[3] ? m[3].toUpperCase() : null,
      mut: null,
    }),
  },
  {
    re: new RegExp(`^(${_HGVS_POS_STR})dup([ACGT]*)$`, "i"),
    make: (m) => ({
      type: "dup",
      pos1: _parseHgvsPos(m[1]),
      pos2: null,
      ref: m[2] ? m[2].toUpperCase() : null,
      mut: null,
    }),
  },
];

export const parseHgvs = (input) => {
  const cleaned = input.trim();
  const cMatch = cleaned.match(/c\.[A-Za-z0-9+\-*>_]+/i);
  if (!cMatch) throw new Error("Missing 'c.' notation in HGVS input");
  const cPayload = cMatch[0];
  const rest =
    cleaned.slice(0, cMatch.index) +
    " " +
    cleaned.slice(cMatch.index + cPayload.length);
  const nmMatch = rest.match(/\bNM_\d+(?:\.\d+)?\b/i);
  let transcriptKey, isNM;
  if (nmMatch) {
    transcriptKey = nmMatch[0].toUpperCase();
    isNM = true;
  } else {
    const geneMatch = rest.match(/[A-Za-z][A-Za-z0-9]{1,9}/);
    if (!geneMatch)
      throw new Error("Missing transcript identifier (gene symbol or NM accession)");
    transcriptKey = geneMatch[0].toUpperCase();
    isNM = false;
  }
  const body = cPayload.slice(2);
  for (const { re, make } of _HGVS_PATTERNS) {
    const m = body.match(re);
    if (m) return { transcriptKey, isNM, ...make(m) };
  }
  throw new Error(`Unsupported HGVS c. notation: c.${body}`);
};

// --- classification -------------------------------------------------------

const PURINES = new Set(["A", "G"]);
const PYRIMIDINES = new Set(["C", "T"]);

// A single-base substitution is a transition when both bases are purines or
// both are pyrimidines; otherwise it is a transversion. (Same purine/pyrimidine
// test used in optiprime-front/src/Job.js.)
const isTransition = (ref, mut) =>
  (PURINES.has(ref) && PURINES.has(mut)) ||
  (PYRIMIDINES.has(ref) && PYRIMIDINES.has(mut));

const TYPE_LABEL = {
  del: "deletion",
  ins: "insertion",
  dup: "duplication",
  delins: "delins",
};

// Map a parsed variant onto the framework's Table 1 lookup.
// Returns { variantClass, isSNV, suggestedModality: "base" | "prime", note }.
export const classifyVariant = (parsed) => {
  if (parsed.type === "sub") {
    const transition = isTransition(parsed.ref, parsed.mut);
    return {
      variantClass: transition ? "transition" : "transversion",
      isSNV: true,
      suggestedModality: transition ? "base" : "prime",
      note: transition
        ? "Transition SNV — amenable to base editing (ABE/CBE)."
        : "Transversion SNV — not correctable by conventional base editors; prime editing.",
    };
  }
  // All small indels (ins/del/delins/dup) route to prime editing per Table 1.
  return {
    variantClass: TYPE_LABEL[parsed.type] || parsed.type,
    isSNV: false,
    suggestedModality: "prime",
    note: "Small insertion/deletion — addressed with prime editing.",
  };
};

// Human-readable single-line description of a parsed variant.
export const describeVariant = (parsed) => {
  const posStr = (p) => {
    if (!p) return "";
    const prefix = p.region === "utr5" ? "-" : p.region === "utr3" ? "*" : "";
    const intron =
      p.intronOffset > 0
        ? `+${p.intronOffset}`
        : p.intronOffset < 0
        ? `${p.intronOffset}`
        : "";
    return `${prefix}${p.cdsOffset}${intron}`;
  };
  const range = parsed.pos2
    ? `${posStr(parsed.pos1)}_${posStr(parsed.pos2)}`
    : posStr(parsed.pos1);
  switch (parsed.type) {
    case "sub":
      return `c.${range}${parsed.ref}>${parsed.mut}`;
    case "del":
      return `c.${range}del${parsed.ref || ""}`;
    case "ins":
      return `c.${range}ins${parsed.mut}`;
    case "dup":
      return `c.${range}dup${parsed.ref || ""}`;
    case "delins":
      return `c.${range}delins${parsed.mut}`;
    default:
      return `c.${range}`;
  }
};
