# N1C Therapeutic Genome-Editing Workflow

An interactive, static web app that walks a user through the N=1 Collaborative
framework for assessing pathogenic variants for gene-editing therapy.

Two entry paths:

- **Start from a variant** — enter an HGVS `c.` variant. It is parsed and
  classified (transition / transversion / indel), the reference and pathogenic
  sequences are rendered (seqviz, MANE/specified transcript), and an editing
  modality is suggested.
- **Answer the flowchart** — walk the decision tree (mode of inheritance, allele
  knockout, variant class) to a recommended editing strategy.

Terminals link out to design tools: base editing → **ColabBE**, prime editing →
**OptiPrime**. A **Variant Assessment Form** can be auto-filled (gene, variant,
genomic coordinates, transcript, variant class, disease/pathogenicity via
ClinVar, editing proposal) and printed/saved as PDF.

The HGVS parsing/classification is fully client-side. The sequence view, ClinVar
lookup, and coordinate resolution call public APIs (UCSC, mygene.info, NCBI
E-utilities) directly from the browser — no backend.

## Develop

```bash
npm install
npm start        # http://localhost:3000
npm run build    # static output in build/
```

## Deploy

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml` (set **Settings → Pages → Source = GitHub
Actions**). Asset paths are relative (`homepage: "."`), so it works at any
`username.github.io/<repo>` path.

Built with Create React App and [seqviz](https://github.com/Lattice-Automation/seqviz).
