import React, { useEffect, useRef, useState } from "react";
import { SeqViz } from "seqviz";
import {
  hgvsToHg38Coords,
  fetchSequenceWindow,
  getContextExonTranslations,
  makeCDSAandTs,
  updateCDS,
} from "./resolver";

const CONTEXT = 40; // bp on each side of the variant
const PER_BASE = 11; // px width per base in the (single-row) linear view

// Inject a thin vertical line at base `offset` inside a seqviz track — used to
// mark an insertion/deletion junction where a track has no base to highlight.
// Ported from optiprime-front/src/ModdedSeqViz.js (addIndelLine).
function useIndelLine(containerRef, indelLine) {
  useEffect(() => {
    if (!indelLine || !containerRef.current) return;
    const { offset, color } = indelLine;
    const findTspan = (scroller, off) => {
      let remaining = off;
      for (const block of scroller.getElementsByClassName("la-vz-seqblock")) {
        const text = block.getElementsByClassName("la-vz-seq")[0];
        if (!text) continue;
        if (remaining < text.childNodes.length) {
          return { text, tspan: text.childNodes[remaining] };
        }
        remaining -= text.childNodes.length;
      }
      return null;
    };
    const inject = () => {
      const root = containerRef.current;
      if (!root) return;
      const scroller = root.getElementsByClassName("la-vz-linear-scroller")[0];
      if (!scroller) return;
      const result = findTspan(scroller, offset);
      if (!result) return;
      const { text, tspan } = result;
      const container = text.parentNode;
      if (container.querySelector("rect[data-indel]")) return;
      const x = parseFloat(tspan.getAttribute("x")) - 2;
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("data-indel", "true");
      rect.setAttribute("style", `fill: ${color};`);
      rect.setAttribute("height", "42");
      rect.setAttribute("width", "2");
      rect.setAttribute("x", x.toString());
      rect.setAttribute("y", "-3");
      container.appendChild(rect);
    };
    inject();
    const observer = new MutationObserver(inject);
    observer.observe(containerRef.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef, indelLine]);
}

// A single labeled sequence track that renders on one row and auto-scrolls so
// `centerIndex` sits in the middle of its scroll box. When `indelLine` is set,
// a vertical marker is drawn at that base instead of a highlight.
function SeqTrack({ label, name, seq, centerIndex, annotations, translations, highlights, indelLine }) {
  const frameRef = useRef(null);
  const trackRef = useRef(null);

  useEffect(() => {
    if (!frameRef.current || !trackRef.current) return;
    const frame = frameRef.current;
    const targetX = centerIndex * PER_BASE;
    const recenter = () => {
      frame.scrollLeft = Math.max(0, targetX - frame.clientWidth / 2);
    };
    recenter();
    const ro = new ResizeObserver(recenter);
    ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [seq, centerIndex]);

  useIndelLine(trackRef, indelLine);

  return (
    <div className="seq-track">
      <div className="seq-track-label">{label}</div>
      <div className="seqviz-frame">
        <div className="seqviz-scroll" ref={frameRef}>
          <div ref={trackRef} style={{ width: `${seq.length * PER_BASE}px`, minWidth: "100%" }}>
            <SeqViz
              seq={seq}
              name={name}
              viewer="linear"
              annotations={annotations}
              translations={translations}
              highlights={highlights}
              showComplement={true}
              showIndex={false}
              style={{ height: "170px", width: "100%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Optional sequence view. Resolves the HGVS variant to hg38 coordinates via
// public APIs (mygene.info + UCSC) and renders the reference (wild-type) and
// pathogenic (variant-applied) sequences. Network-backed; rendered on demand.
export default function SequenceView({ input }) {
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  async function load() {
    setState("loading");
    setError(null);
    try {
      const resolved = await hgvsToHg38Coords(input);
      const win = await fetchSequenceWindow(resolved.coords, CONTEXT);
      setData({ resolved, win });
      setState("done");
    } catch (e) {
      setError(e.message);
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <div className="seqview-cta">
        <button className="btn ghost" onClick={load}>
          🧬 Show reference & pathogenic sequences
        </button>
        <span className="muted small">
          Fetches hg38 coordinates and sequence from public APIs (UCSC / mygene.info).
        </span>
      </div>
    );
  }

  if (state === "loading") {
    return <div className="seqview-status">Resolving coordinates and fetching sequence…</div>;
  }

  if (state === "error") {
    return (
      <div className="seqview">
        <div className="alert error">⚠ Could not load sequence: {error}</div>
        <button className="btn ghost" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  const { resolved, win } = data;
  const { seq, center } = win;
  const { alleles, coords, gene, strand, isNM, refSeq, warning } = resolved;

  // Reference (wild-type) window is the fetched genomic sequence. Pathogenic
  // window applies the variant: replace the ref allele at `center` with the mut
  // allele (both are + strand). ins/dup have ref length 0.
  const refAllele = alleles.ref || "";
  const mutAllele = alleles.mut || "";
  const refLen = refAllele.length;
  const mutLen = mutAllele.length;
  const refSeqWin = seq;
  const pathSeqWin = seq.slice(0, center) + mutAllele + seq.slice(center + refLen);

  // Transcript CDS track (exon annotations + amino-acid translations) built like
  // the OptiPrime site. NM input → that transcript; gene symbol → MANE Select.
  const refCdsList = getContextExonTranslations(refSeq, Number(coords.pos), CONTEXT);
  const refAT = refCdsList.map(makeCDSAandTs);
  // Reframe the CDS list onto the pathogenic sequence (handles indel frame shift).
  const pathCdsList = refCdsList
    .map((cds) => updateCDS(cds, { start: center, end: center + mutLen }, refLen - mutLen))
    .filter(Boolean);
  const pathAT = pathCdsList.map(makeCDSAandTs);

  // Highlight the affected base(s) where a track has them; where it has none
  // (an insertion on the reference, or a deletion on the pathogenic), draw a
  // junction line instead — like OptiPrime.
  const refHi = refLen > 0 ? [{ start: center, end: center + refLen, color: "#86efac" }] : [];
  const pathHi = mutLen > 0 ? [{ start: center, end: center + mutLen, color: "#fca5a5" }] : [];
  const refLine = refLen === 0 ? { offset: center, color: "#16a34a" } : null;
  const pathLine = mutLen === 0 ? { offset: center, color: "#dc2626" } : null;

  const txName = refSeq?.name;
  const txLabel = isNM ? "Transcript" : "MANE Select transcript";
  const vizName = txName || `${gene} ${coords.chrom}`;

  return (
    <div className="seqview">
      <div className="seqview-meta">
        <span className="pill pill-coord">
          {gene} · {coords.chrom}:{Number(coords.pos) + 1} ({strand} strand, hg38)
        </span>
        {txName && (
          <span className="muted small">
            {txLabel} <code>{txName}</code> · sequences on the + genomic strand
            {strand === "-" && " (transcript is reverse-complement)"}.
          </span>
        )}
      </div>
      {warning && <div className="alert warn">⚠ {warning}</div>}

      <SeqTrack
        label="Reference (wild-type)"
        name={vizName}
        seq={refSeqWin}
        centerIndex={center}
        annotations={refAT.map((x) => x.annotation)}
        translations={refAT.map((x) => x.translation)}
        highlights={refHi}
        indelLine={refLine}
      />
      <SeqTrack
        label="Pathogenic (variant)"
        name={vizName}
        seq={pathSeqWin}
        centerIndex={center}
        annotations={pathAT.map((x) => x.annotation)}
        translations={pathAT.map((x) => x.translation)}
        highlights={pathHi}
        indelLine={pathLine}
      />
    </div>
  );
}
