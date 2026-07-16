import React, { useEffect, useMemo, useState } from "react";
import { hgvsToHg38Coords, fetchClinVarInfo } from "./resolver";

// Editing-proposal text seeded from the reached terminal node.
const PROPOSAL_BY_KIND = {
  base: "Corrective base editing (ABE/CBE) to revert the pathogenic variant to the reference allele.",
  prime: "Corrective prime editing (Cas9 nickase + RT + pegRNA) to install the reference allele.",
  noncorrective: "Non-corrective strategy: selective disruption/knockout of the pathogenic allele.",
  outofscope: "Variant is outside the corrective framework scope; consider a non-corrective strategy.",
};

const REC_OPTIONS = [
  "Recommended for Translational Development",
  "Recommended for Preclinical Investigation",
  "Not Recommended for Development",
];

// A labeled row with an editable textarea (uncontrolled; mounted once autofill
// values are ready so defaultValue reflects them).
function Row({ label, value, rows = 2 }) {
  return (
    <tr>
      <th>{label}</th>
      <td>
        <textarea className="vaf-input" rows={rows} defaultValue={value || ""} />
      </td>
    </tr>
  );
}

// Auto-filled Variant Assessment Form. Molecular fields are derived from the
// parsed HGVS variant + genomic resolution + ClinVar; the editing proposal and
// rationale are seeded from the reached terminal; clinical fields stay editable.
export default function VariantAssessmentForm({ variant, history, terminal }) {
  // resolved: { coords, clinvar } once async lookups settle. ready gates render
  // so uncontrolled textareas mount with their auto-filled defaultValues.
  const [resolved, setResolved] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!variant?.input) {
      setResolved({ coords: null, clinvar: null });
      setReady(true);
      return;
    }
    setReady(false);
    Promise.allSettled([hgvsToHg38Coords(variant.input), fetchClinVarInfo(variant.input)]).then(
      ([coordsR, cvR]) => {
        if (cancelled) return;
        const r = coordsR.status === "fulfilled" ? coordsR.value : null;
        setResolved({
          coords: r
            ? { chrom: r.coords.chrom, pos: Number(r.coords.pos) + 1, gene: r.gene, txName: r.refSeq?.name }
            : null,
          clinvar: cvR.status === "fulfilled" ? cvR.value : null,
        });
        setReady(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [variant?.input]);

  const inheritance = useMemo(() => {
    const hit = (history || []).find((h) => h.q === "What is the mode of inheritance?");
    return hit ? hit.a : "";
  }, [history]);

  if (!ready) {
    return (
      <section className="card vaf">
        <h2>Variant Assessment Form</h2>
        <div className="seqview-status">Looking up variant (genomic coordinates + ClinVar)…</div>
      </section>
    );
  }

  const coords = resolved?.coords;
  const clinvar = resolved?.clinvar;

  const geneName = coords?.gene || (variant && !variant.isNM ? variant.transcript : "");
  const variantStr = variant
    ? variant.isNM
      ? variant.input
      : `${variant.transcript}:${variant.desc}`
    : "";
  const coordStr = coords ? `${coords.chrom}:${coords.pos} (hg38)` : "";
  const classStr = variant ? `${variant.variantClass}${variant.isSNV ? " (SNV)" : " (indel)"}` : "";
  const diseaseStr = clinvar?.disease
    ? clinvar.omim
      ? `${clinvar.disease} (OMIM ${clinvar.omim})`
      : clinvar.disease
    : "";
  const pathogenicityStr = clinvar?.significance
    ? `${clinvar.significance}${clinvar.accession ? ` (ClinVar ${clinvar.accession})` : ""}`
    : "";
  const proposal = terminal ? PROPOSAL_BY_KIND[terminal.kind] || "" : "";
  const rationale = terminal ? terminal.summary : "";

  return (
    <section className="card vaf" id="vaf">
      <div className="vaf-head">
        <h2>Variant Assessment Form</h2>
        <button className="btn ghost small-btn no-print" onClick={() => window.print()}>
          🖨 Print / Save as PDF
        </button>
      </div>
      <p className="muted small no-print">
        Molecular and disease fields are auto-filled from the variant, its genomic
        resolution, and ClinVar; the editing strategy is seeded from your result.
        Review and complete the clinical fields — all fields are editable.
      </p>

      <table className="vaf-table">
        <tbody>
          <tr>
            <td className="vaf-section" colSpan={2}>
              Molecular Genetics
            </td>
          </tr>
          <Row label="Disease (OMIM)" value={diseaseStr} />
          <Row label="Gene" value={geneName} rows={1} />
          <Row label="Variant(s)" value={variantStr} rows={1} />
          <Row label="Transcript" value={coords?.txName || ""} rows={1} />
          <Row label="Genomic coordinates" value={coordStr} rows={1} />
          <Row label="Variant class" value={classStr} rows={1} />
          <Row label="Pathogenicity" value={pathogenicityStr} />
          <Row label="Inheritance / Pathomechanism" value={inheritance} />
          <Row label="Misc. molecular features" value="" />
          <Row label="GeneReviews" value="" rows={1} />

          <tr>
            <td className="vaf-section" colSpan={2}>
              Clinical Criteria
            </td>
          </tr>
          <Row label="Natural history" value="" rows={3} />
          <Row label="Progression / intervention window" value="" />
          <Row label="Affected / target tissue(s)" value="" />
          <Row label="Available medical therapies" value="" />
          <Row label="Available genetic therapies" value="" />

          <tr>
            <td className="vaf-section" colSpan={2}>
              Interventional Genetics
            </td>
          </tr>
          <Row label="Gene editing proposal" value={proposal} />
          <Row label="Scientific rationale" value={rationale} rows={3} />
          <Row label="Predicted off-target risks" value="" />
          <Row label="Technical limitations / considerations" value="" rows={3} />
        </tbody>
      </table>

      <div className="vaf-rec print-only">
        <div className="vaf-section-title">Committee Recommendation</div>
        {REC_OPTIONS.map((opt) => (
          <label key={opt} className="vaf-rec-opt">
            <input type="radio" name="vaf-rec" /> {opt}
          </label>
        ))}
        <div className="vaf-comments">
          <div className="field-label">Comments</div>
          <textarea className="vaf-input" rows={4} defaultValue="" />
        </div>
      </div>
    </section>
  );
}
