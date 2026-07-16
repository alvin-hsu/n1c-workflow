// Network-backed HGVS → genomic-coordinate + reference-sequence resolution.
// Ported from optiprime-front/src/Utils.js. These functions make live calls to
// public third-party APIs (mygene.info + UCSC Genome Browser) from the browser;
// no backend is involved, so the site remains statically hostable. Used only to
// power the optional seqviz sequence view.

import { parseHgvs } from "./hgvs";

export const revcomp = (seq) => {
  const complement = seq
    .toUpperCase()
    .replaceAll("A", "t")
    .replaceAll("C", "g")
    .replaceAll("G", "c")
    .replaceAll("T", "a")
    .replaceAll("N", "n")
    .toUpperCase();
  return complement.split("").reverse().join("");
};

const computeProteinPos = (refSeq, genomicPos) => {
  if (!refSeq) return null;
  const pos = parseInt(genomicPos, 10);
  const cdsStart = refSeq["cdsStart"];
  const cdsEnd = refSeq["cdsEnd"];
  const strand = refSeq["strand"];
  const exonStarts = refSeq["exonStarts"].split(",").map(Number).filter((n) => !isNaN(n) && n !== 0);
  const exonEnds = refSeq["exonEnds"].split(",").map(Number).filter((n) => !isNaN(n) && n !== 0);

  const idxs =
    strand === "+"
      ? Array.from({ length: exonStarts.length }, (_, i) => i)
      : Array.from({ length: exonStarts.length }, (_, i) => exonStarts.length - 1 - i);

  let cdsOffset = 0;
  for (const i of idxs) {
    const exStart = Math.max(exonStarts[i], cdsStart);
    const exEnd = Math.min(exonEnds[i], cdsEnd);
    if (exEnd <= exStart) continue;
    if (strand === "+") {
      if (pos < exStart) break;
      if (pos < exEnd) return Math.floor((cdsOffset + pos - exStart) / 3) + 1;
      cdsOffset += exEnd - exStart;
    } else {
      if (pos >= exEnd) break;
      if (pos >= exStart) return Math.floor((cdsOffset + exEnd - 1 - pos) / 3) + 1;
      cdsOffset += exEnd - exStart;
    }
  }
  return null;
};

const cdsOffsetToGenomicPos = (refSeq, region, cdsOffset, intronOffset = 0) => {
  if (!refSeq) return null;
  const cdsStart = refSeq["cdsStart"];
  const cdsEnd = refSeq["cdsEnd"];
  const strand = refSeq["strand"];
  const exStarts = refSeq["exonStarts"].split(",").map(Number).filter((n) => !isNaN(n) && n !== 0);
  const exEnds = refSeq["exonEnds"].split(",").map(Number).filter((n) => !isNaN(n) && n !== 0);
  const exons = exStarts.map((s, i) => ({ gStart: s, gEnd: exEnds[i] }));
  const txExons = strand === "+" ? exons : exons.slice().reverse();
  const clip = (ex) => {
    let s = ex.gStart,
      e = ex.gEnd;
    if (region === "cds") {
      s = Math.max(s, cdsStart);
      e = Math.min(e, cdsEnd);
    } else if (region === "utr5" && strand === "+") {
      e = Math.min(e, cdsStart);
    } else if (region === "utr5" && strand === "-") {
      s = Math.max(s, cdsEnd);
    } else if (region === "utr3" && strand === "+") {
      s = Math.max(s, cdsEnd);
    } else if (region === "utr3" && strand === "-") {
      e = Math.min(e, cdsStart);
    }
    return e > s ? { gStart: s, gEnd: e } : null;
  };
  const applyIntron = (g) => (strand === "+" ? g + intronOffset : g - intronOffset);
  if (region === "utr5") {
    let total = 0;
    for (const ex of txExons) {
      const c = clip(ex);
      if (c) total += c.gEnd - c.gStart;
    }
    const target = total - cdsOffset + 1;
    if (target < 1) return null;
    let count = 0;
    for (const ex of txExons) {
      const c = clip(ex);
      if (!c) continue;
      const len = c.gEnd - c.gStart;
      if (count + len >= target) {
        const within = target - count;
        const g = strand === "+" ? c.gStart + within - 1 : c.gEnd - within;
        return applyIntron(g);
      }
      count += len;
    }
    return null;
  }
  let count = 0;
  for (const ex of txExons) {
    const c = clip(ex);
    if (!c) continue;
    const len = c.gEnd - c.gStart;
    if (count + len >= cdsOffset) {
      const within = cdsOffset - count;
      const g = strand === "+" ? c.gStart + within - 1 : c.gEnd - within;
      return applyIntron(g);
    }
    count += len;
  }
  return null;
};

const cdsOffsetToGenomicRange = (refSeq, pos1, pos2) => {
  const g1 = cdsOffsetToGenomicPos(refSeq, pos1.region, pos1.cdsOffset, pos1.intronOffset);
  const p2 = pos2 || pos1;
  const g2 = cdsOffsetToGenomicPos(refSeq, p2.region, p2.cdsOffset, p2.intronOffset);
  if (g1 === null || g2 === null) return null;
  return { genomicStart: Math.min(g1, g2), genomicEnd: Math.max(g1, g2) };
};

const _fetchGenomicSeq = async ({ assembly, chrom }, startPos, endPos) => {
  const url = new URL("https://api.genome.ucsc.edu/getData/sequence");
  url.search = new URLSearchParams({ genome: assembly, chrom, start: startPos, end: endPos })
    .toString()
    .replace(/&/g, ";");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Failed to fetch sequence from UCSC");
  const data = await resp.json();
  return (data["dna"] || "").toUpperCase();
};

const _fetchTrackEntries = async ({ assembly, chrom, start, end }, track) => {
  const url = new URL("https://api.genome.ucsc.edu/getData/track");
  url.search = new URLSearchParams({ track, genome: assembly, chrom, start, end })
    .toString()
    .replace(/&/g, ";");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${track} from UCSC`);
  const data = await resp.json();
  return data[track] || [];
};

export const resolveTranscript = async (transcriptKey, isNM, assembly) => {
  const unversionedNm = isNM ? transcriptKey.replace(/\.\d+$/, "") : null;
  const q = isNM ? `refseq.rna:${unversionedNm}` : `symbol:${transcriptKey}`;
  const myGeneUrl = new URL("https://mygene.info/v3/query");
  myGeneUrl.search = new URLSearchParams({
    q,
    species: "human",
    fields: "symbol,genomic_pos,genomic_pos_hg19,genomic_pos_hg38",
  }).toString();
  const myGeneResp = await fetch(myGeneUrl).then((r) => r.json());
  const hits = myGeneResp["hits"] || [];
  const hit = isNM ? hits[0] : hits.find((h) => (h.symbol || "").toUpperCase() === transcriptKey);
  if (!hit) throw new Error(`No gene found for ${transcriptKey}`);
  const gene = hit["symbol"] || transcriptKey;
  const candidates = [
    hit[`genomic_pos_${assembly}`],
    assembly === "hg38" ? hit["genomic_pos"] : null,
    assembly === "hg19" ? hit["genomic_pos_hg19"] : null,
  ].filter(Boolean);
  let genomicPos = candidates[0];
  if (Array.isArray(genomicPos)) {
    genomicPos = genomicPos.find((g) => /^(chr)?(\d+|[XYM])$/.test(g.chr)) || genomicPos[0];
  }
  if (!genomicPos) throw new Error(`No ${assembly} genomic location for ${transcriptKey}`);
  const rawChr = String(genomicPos["chr"]);
  const chrom = rawChr.startsWith("chr") ? rawChr : `chr${rawChr}`;
  const pad = 1000;
  const chrStart = Math.max(0, Math.min(genomicPos["start"], genomicPos["end"]) - pad);
  const chrEnd = Math.max(genomicPos["start"], genomicPos["end"]) + pad;
  const curatedEntries = await _fetchTrackEntries(
    { assembly, chrom, start: chrStart, end: chrEnd },
    "ncbiRefSeqCurated"
  );
  let refSeq;
  if (isNM) {
    refSeq = curatedEntries.find((e) => e.name?.toUpperCase() === transcriptKey);
    if (!refSeq) {
      refSeq = curatedEntries.find(
        (e) => e.name?.toUpperCase().replace(/\.\d+$/, "") === unversionedNm
      );
    }
    if (!refSeq) {
      throw new Error(
        `Transcript ${transcriptKey} not found in ncbiRefSeqCurated at ${chrom}:${chrStart}-${chrEnd}`
      );
    }
  } else {
    const geneMatches = curatedEntries.filter((e) => (e.name2 || "").toUpperCase() === transcriptKey);
    if (geneMatches.length === 0) {
      throw new Error(`No ncbiRefSeqCurated entries for ${transcriptKey} at ${chrom}:${chrStart}-${chrEnd}`);
    }
    const selectEntries = await _fetchTrackEntries(
      { assembly, chrom, start: chrStart, end: chrEnd },
      "ncbiRefSeqSelect"
    );
    const selectNames = new Set(selectEntries.map((e) => e.name?.toUpperCase()));
    refSeq = geneMatches.find((e) => selectNames.has(e.name?.toUpperCase()));
    if (!refSeq) {
      refSeq = geneMatches.reduce((best, e) => {
        const len = (e.cdsEnd ?? 0) - (e.cdsStart ?? 0);
        const bestLen = best ? best.cdsEnd - best.cdsStart : -1;
        return len > bestLen ? e : best;
      }, null);
    }
  }
  return { chrom, refSeq, gene };
};

export const hgvsToHg38Coords = async (input, assembly = "hg38") => {
  const parsed = parseHgvs(input);
  const { transcriptKey, isNM, type, pos1, pos2, mut: hMut, ref: hRef } = parsed;
  const { chrom, refSeq, gene } = await resolveTranscript(transcriptKey, isNM, assembly);
  const strand = refSeq["strand"];
  const range = cdsOffsetToGenomicRange(refSeq, pos1, pos2);
  if (!range) throw new Error(`Failed to map ${input} to genomic coordinates`);

  if (pos1.region === "cds" && pos1.intronOffset === 0 && type === "sub") {
    const expectedAa = Math.floor((pos1.cdsOffset - 1) / 3) + 1;
    const actualAa = computeProteinPos(refSeq, range.genomicStart);
    if (actualAa !== expectedAa) {
      throw new Error(
        `HGVS self-check failed: c.${pos1.cdsOffset} mapped to ` +
          `${chrom}:${range.genomicStart} (codon ${actualAa}), expected codon ${expectedAa}.`
      );
    }
  }
  {
    const g1 = cdsOffsetToGenomicPos(refSeq, "cds", 1, 0);
    const g2 = cdsOffsetToGenomicPos(refSeq, "cds", 2, 0);
    const g3 = cdsOffsetToGenomicPos(refSeq, "cds", 3, 0);
    const [lo, hi] = [Math.min(g1, g2, g3), Math.max(g1, g2, g3)];
    const seq = await _fetchGenomicSeq({ assembly, chrom }, lo, hi + 1);
    const baseAt = (g) => seq[g - lo];
    const txCodon = [g1, g2, g3]
      .map((g) => {
        const b = baseAt(g);
        return strand === "+" ? b : revcomp(b);
      })
      .join("")
      .toUpperCase();
    if (txCodon !== "ATG") {
      throw new Error(
        `HGVS self-check failed: start codon of ${refSeq["name"]} (strand ${strand}) ` +
          `reads "${txCodon}" at c.1–c.3, expected "ATG".`
      );
    }
  }

  let ref, mut, genomicPos, warning = null;
  if (type === "sub") {
    genomicPos = range.genomicStart;
    ref = strand === "+" ? hRef : revcomp(hRef);
    mut = strand === "+" ? hMut : revcomp(hMut);
  } else if (type === "del") {
    genomicPos = range.genomicStart;
    ref = hRef
      ? strand === "+"
        ? hRef
        : revcomp(hRef)
      : await _fetchGenomicSeq({ assembly, chrom }, range.genomicStart, range.genomicEnd + 1);
    mut = "";
  } else if (type === "delins") {
    genomicPos = range.genomicStart;
    ref = await _fetchGenomicSeq({ assembly, chrom }, range.genomicStart, range.genomicEnd + 1);
    mut = strand === "+" ? hMut : revcomp(hMut);
  } else if (type === "ins") {
    genomicPos = range.genomicEnd;
    ref = "";
    mut = strand === "+" ? hMut : revcomp(hMut);
  } else if (type === "dup") {
    const origSeq = await _fetchGenomicSeq({ assembly, chrom }, range.genomicStart, range.genomicEnd + 1);
    if (hRef) {
      const expectedPlus = strand === "+" ? hRef : revcomp(hRef);
      if (origSeq.toUpperCase() !== expectedPlus.toUpperCase()) {
        const actualTx = strand === "+" ? origSeq : revcomp(origSeq);
        warning = `HGVS specifies reference "${hRef}" at the duplication site, but the genome has "${actualTx}".`;
      }
    }
    genomicPos = strand === "+" ? range.genomicEnd + 1 : range.genomicStart;
    ref = "";
    mut = origSeq;
  } else {
    throw new Error(`Unhandled variant type: ${type}`);
  }

  return {
    coords: { assembly, chrom, pos: genomicPos.toString() },
    alleles: { vName: input, ref, mut },
    gene,
    strand,
    isNM, // true when the user specified an NM accession (vs a gene symbol)
    refSeq,
    warning,
  };
};

// Build CDS exon segments (with reading frame) that overlap a window centered on
// `target` (± contextLen). Ported from optiprime-front/src/Utils.js. Returns
// window-relative { name, start, end, direction, frame } entries.
export const getContextExonTranslations = (geneData, target, contextLen) => {
  if (typeof geneData === "undefined") return [];
  const contextStart = Number(target) - Number(contextLen);
  const contextEnd = Number(target) + Number(contextLen);
  const exonStarts = geneData["exonStarts"].split(",").map(Number).filter((n) => !isNaN(n) && n !== 0);
  const exonEnds = geneData["exonEnds"].split(",").map(Number).filter((n) => !isNaN(n) && n !== 0);
  const exonFrames = geneData["exonFrames"].split(",").map(Number).filter((n) => !isNaN(n));

  if (geneData["strand"] === "+") {
    exonStarts[0] = geneData["cdsStart"];
    exonEnds[exonEnds.length - 1] = geneData["cdsEnd"];
    exonFrames[0] = 0;
  } else {
    exonStarts[0] = geneData["cdsStart"];
    exonEnds[exonEnds.length - 1] = geneData["cdsEnd"];
    exonFrames[exonFrames.length - 1] = 0;
  }
  let contextExons = [];
  for (let i = 0; i < exonStarts.length; i++) {
    if (exonStarts[i] <= contextEnd && exonEnds[i] >= contextStart) {
      const exonNumber = geneData["strand"] === "+" ? i + 1 : exonStarts.length - i;
      const startOffset = Math.max(0, exonStarts[i] - contextStart);
      const endOffset = Math.min(exonEnds[i], contextEnd) - contextStart;
      let adjustedFrame = exonFrames[i];
      if (exonStarts[i] < contextStart && geneData["strand"] === "+") {
        adjustedFrame = (exonFrames[i] + (contextStart - exonStarts[i])) % 3;
      }
      if (exonEnds[i] > contextEnd && geneData["strand"] === "-") {
        adjustedFrame = (exonFrames[i] + (exonEnds[i] - contextEnd)) % 3;
      }
      contextExons.push({
        name: `${geneData["name2"]} Exon ${exonNumber}`,
        start: startOffset,
        end: endOffset,
        direction: geneData["strand"],
        frame: adjustedFrame,
      });
    }
  }
  return contextExons.map((cds) => ({ ...cds, frame: (3 - cds.frame) % 3 }));
};

// Adjust a CDS segment for an edit of `delta` length within `selection`
// (window-relative). Used to reframe the reference CDS list onto the pathogenic
// sequence for indels. Ported from optiprime-front/src/Utils.js.
export const updateCDS = (cds, selection, delta) => {
  if (selection.start <= cds.start) {
    if (selection.end < cds.start) {
      return { ...cds, start: cds.start + delta, end: cds.end + delta };
    } else if (selection.end >= cds.end) {
      return null;
    } else {
      const selLen = selection.end - selection.start;
      const newStart = selection.start + selLen + delta;
      const newFrame =
        cds.direction === "+" ? (((cds.frame + cds.start - newStart) % 3) + 3) % 3 : cds.frame;
      return { ...cds, start: newStart, end: cds.end + delta, frame: newFrame };
    }
  } else if (selection.start < cds.end) {
    if (selection.end < cds.end) {
      return { ...cds, end: cds.end + delta };
    } else {
      const newFrame =
        cds.direction === "+" ? cds.frame : (((cds.frame + cds.end - selection.start) % 3) + 3) % 3;
      return { ...cds, end: selection.start, frame: newFrame };
    }
  } else {
    return { ...cds };
  }
};

// Convert one CDS segment into a seqviz annotation + translation. Ported from
// optiprime-front/src/Utils.js.
export const makeCDSAandTs = ({ name, start, end, direction, frame }) => {
  const atStart = Math.min(start, end);
  const atEnd = Math.max(start, end);
  const length = atEnd - atStart;
  const tDelta = direction === "+" ? frame : (length - frame) % 3;
  const annotation = {
    name: name ?? "CDS",
    start: atStart,
    end: atEnd,
    direction: direction === "+" ? 1 : -1,
    color: "#fdba74",
  };
  const translation = {
    start: atStart + tDelta,
    end: atEnd,
    direction: direction === "+" ? 1 : -1,
  };
  return { annotation, translation };
};

// Fetch a window of reference sequence centered on a genomic position.
// Returns { seq, windowStart, center } where windowStart is the 0-based genomic
// coordinate of seq[0] and center is the index of the variant base within seq.
// Look up a variant in ClinVar by HGVS expression (best effort). Returns
// { disease, significance, omim } or null. Uses NCBI E-utilities (CORS-enabled).
export const fetchClinVarInfo = async (hgvsInput) => {
  const esearch = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  esearch.search = new URLSearchParams({
    db: "clinvar",
    term: hgvsInput,
    retmode: "json",
  }).toString();
  const searchData = await fetch(esearch).then((r) => r.json());
  const ids = searchData?.esearchresult?.idlist || [];
  if (ids.length === 0) return null;

  const esummary = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  esummary.search = new URLSearchParams({
    db: "clinvar",
    id: ids[0],
    retmode: "json",
  }).toString();
  const sumData = await fetch(esummary).then((r) => r.json());
  const rec = sumData?.result?.[ids[0]];
  if (!rec) return null;

  // New (germline_classification) and legacy (clinical_significance) shapes.
  const cls = rec.germline_classification || rec.clinical_significance || {};
  const significance = cls.description || "";
  const traitSet = cls.trait_set || rec.trait_set || [];
  const diseases = traitSet
    .map((t) => t.trait_name)
    .filter((n) => n && n.toLowerCase() !== "not provided" && n.toLowerCase() !== "not specified");
  let omim = null;
  for (const t of traitSet) {
    const xref = (t.trait_xrefs || []).find((x) => (x.db_source || "").toUpperCase() === "OMIM");
    if (xref) {
      omim = xref.db_id;
      break;
    }
  }
  return { disease: diseases.join("; "), significance, omim, accession: rec.accession || null };
};

// Window spans [pos - contextLen, pos + contextLen] so the variant sits at index
// `contextLen` — matching getContextExonTranslations' contextStart convention.
export const fetchSequenceWindow = async (coords, contextLen) => {
  const { assembly, chrom, pos } = coords;
  const center = parseInt(pos, 10);
  const windowStart = center - contextLen;
  const windowEnd = center + contextLen;
  const seq = await _fetchGenomicSeq({ assembly, chrom }, windowStart, windowEnd);
  return { seq, windowStart, center: contextLen };
};
