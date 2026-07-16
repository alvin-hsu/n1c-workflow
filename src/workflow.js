// Declarative model of the N1C therapeutic genome-editing decision tree
// Kept as a single source of truth so the
// tree can be audited against the figure.
//
// A node is either a QUESTION { id, title, help, options:[{label, help, next}] }
// or a TERMINAL { id, terminal: true, ... }. `next` is a node id.

export const START_NODE = "inheritance";

export const NODES = {
  // Step 2 — Mode of inheritance?
  inheritance: {
    id: "inheritance",
    title: "What is the mode of inheritance?",
    help:
      "Relevant patterns: autosomal/X-linked dominant or recessive. Allelic state (het/hom/hemizygous) and dosage sensitivity inform the required editing outcome.",
    options: [
      {
        label: "Recessive",
        help: "Biallelic loss-of-function. Restore a functional allele.",
        next: "transition",
      },
      {
        label: "Dominant",
        help: "A single pathogenic allele drives disease (GoF / dominant-negative).",
        next: "knockout",
      },
      {
        label: "Haploinsufficiency",
        help: "Disease from reduced dosage; the pathogenic allele must be corrected, not disrupted.",
        next: "transition",
      },
    ],
  },

  // Step 2b — Dominant branch: can the pathogenic allele be knocked out?
  knockout: {
    id: "knockout",
    title: "Can the pathogenic allele be selectively knocked out?",
    help:
      "For dominant disorders, selective disruption of the pathogenic allele may be therapeutic — provided haploinsufficiency is not a concern and the allele can be discriminated (allele-specific PAM / SNV).",
    options: [
      {
        label: "Yes — disruption is beneficial",
        help: "Selective knockout of the pathogenic allele is predicted to help.",
        next: "disrupt",
      },
      {
        label: "No — correction is required",
        help: "Knockout is not appropriate (e.g. haploinsufficiency, no allele discrimination).",
        next: "transition",
      },
    ],
  },

  // Step 3 — Variant Correction: transition variant?
  transition: {
    id: "transition",
    title: "Is the required correction a transition substitution?",
    help:
      "Transitions (A↔G, C↔T) are correctable with base editors and are the preferred first-line modality. Transversions and small indels require prime editing.",
    options: [
      {
        label: "Yes — transition",
        help: "Correctable by ABE/CBE.",
        next: "baseEdit",
      },
      {
        label: "No — transversion or small indel",
        help: "Requires prime editing.",
        next: "primeEdit",
      },
    ],
  },

  // --- Terminals ---------------------------------------------------------
  baseEdit: {
    id: "baseEdit",
    terminal: true,
    kind: "base",
    title: "Corrective Base Editing",
    summary:
      "Direct correction with an adenine or cytosine base editor (ABE/CBE). Preferred first-line modality: greater translational maturity, generally higher efficiency, and simpler gRNA design.",
    considerations: [
      "Confirm a compatible PAM positions the target base within the editor's activity window.",
      "Assess bystander edits and predicted product purity.",
      "If base editing is unsuitable, consider prime editing instead (see below).",
    ],
    cta: {
      label: "Design base editor with ColabBE",
      url: "https://colab.research.google.com/github/angusli98/ColabBE/blob/main/ColabBE_v2.ipynb",
    },
    override: {
      label:
        "Switch to prime editing if: no available PAM · bystanders not tolerated · low base-editing efficiency",
      next: "primeEdit",
    },
  },

  primeEdit: {
    id: "primeEdit",
    terminal: true,
    kind: "prime",
    title: "Corrective Prime Editing",
    summary:
      "Correction with a prime editor (Cas9 nickase + reverse transcriptase + pegRNA). Handles transversions and small insertions/deletions; second-line when base editing is not feasible or optimal.",
    considerations: [
      "Design the pegRNA: RT template, primer binding site, and nicking sites.",
      "Evaluate predicted editing efficiency and product purity.",
      "Broader editing scope but greater design/optimization burden than base editing.",
    ],
    cta: { label: "Design pegRNA at OptiPrime", url: "https://optipri.me" },
  },

  disrupt: {
    id: "disrupt",
    terminal: true,
    kind: "noncorrective",
    title: "Disrupt the Pathogenic Allele (Non-Corrective)",
    summary:
      "Selective inactivation of the pathogenic allele rather than direct correction — appropriate for dominant gain-of-function / dominant-negative disorders where allele knockout is beneficial.",
    considerations: [
      "Requires allele discrimination (pathogenic-allele-specific PAM, SNV in the gRNA target, or linked variant).",
      "Confirm haploinsufficiency is not a concern for the disrupted allele.",
      "Base or prime editing can install disrupting edits; extensive specificity validation needed.",
    ],
    note:
      "Non-corrective strategies (exon skipping, splice modulation, disease-modifier editing, knockdown) may also apply where direct correction is not feasible or a hypomorphic edit is supported by functional evidence.",
  },

  outOfScope: {
    id: "outOfScope",
    terminal: true,
    kind: "outofscope",
    title: "Outside the Corrective Framework Scope",
    summary:
      "This framework's corrective workflows cover single-nucleotide variants and small insertions/deletions (<10 bp).",
    considerations: [
      "Excluded: indels ≥10 bp, copy-number/structural variants, repeat expansions, mitochondrial variants, imprinting/methylation and polygenic disorders.",
      "A non-corrective strategy (e.g. exon skipping, disease-modifier editing) may still be considered.",
    ],
  },
};
