import React, { useMemo, useState } from "react";
import "./App.css";
import { NODES, START_NODE } from "./workflow";
import { parseHgvs, classifyVariant, describeVariant } from "./hgvs";
import SequenceView from "./SequenceView";
import VariantAssessmentForm from "./VariantAssessmentForm";

const MODALITY_TO_TERMINAL = { base: "baseEdit", prime: "primeEdit" };

// Small helper: a single answered step in the path history.
// { nodeId, choiceLabel } — choiceLabel null for the auto-seeded transition step.

export default function App() {
  // history is the ordered list of visited question nodes + the choice taken.
  const [history, setHistory] = useState([]);
  const [currentId, setCurrentId] = useState(START_NODE);
  const [started, setStarted] = useState(false);

  // Which entry path the user picked: null (not chosen) | "hgvs" | "flowchart".
  const [mode, setMode] = useState(null);
  const [showVaf, setShowVaf] = useState(false);

  // HGVS input state
  const [hgvsInput, setHgvsInput] = useState("");
  const [parsed, setParsed] = useState(null); // { variant, classification }
  const [hgvsError, setHgvsError] = useState(null);

  const current = NODES[currentId];

  const parseSummary = useMemo(() => {
    if (!parsed) return null;
    const { variant, classification } = parsed;
    return {
      input: parsed.input,
      transcript: variant.transcriptKey,
      isNM: variant.isNM,
      desc: describeVariant(variant),
      ref: variant.ref,
      mut: variant.mut,
      ...classification,
    };
  }, [parsed]);

  function runParse(str) {
    setHgvsError(null);
    setParsed(null);
    const trimmed = str.trim();
    if (!trimmed) return;
    try {
      const variant = parseHgvs(trimmed);
      const classification = classifyVariant(variant);
      setParsed({ variant, classification, input: trimmed });
    } catch (err) {
      setHgvsError(err.message);
    }
  }

  function handleParse(e) {
    e.preventDefault();
    runParse(hgvsInput);
  }

  function pickExample(str) {
    setHgvsInput(str);
    runParse(str);
  }

  function choose(option) {
    setHistory((h) => [
      ...h,
      { nodeId: currentId, q: NODES[currentId].title, a: option.label },
    ]);
    setCurrentId(option.next);
  }

  function back() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setCurrentId(prev.nodeId);
      return h.slice(0, -1);
    });
  }

  function restart() {
    setHistory([]);
    setCurrentId(START_NODE);
    setStarted(false);
    setMode(null);
    setShowVaf(false);
    setParsed(null);
    setHgvsInput("");
    setHgvsError(null);
  }

  function chooseMode(m) {
    setMode(m);
    setHistory([]);
    setParsed(null);
    setHgvsError(null);
    if (m === "flowchart") {
      setCurrentId(START_NODE);
      setStarted(true);
    } else {
      setStarted(false);
    }
  }

  // Jump straight to a terminal (used by the base→prime override button and by
  // the "use this recommendation" button on the parsed HGVS summary). `q`/`a`
  // are the breadcrumb question/answer text for this jump.
  function jumpTo(nodeId, q, a) {
    setHistory((h) => [...h, { nodeId: currentId, q, a }]);
    setCurrentId(nodeId);
    setStarted(true);
  }

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-inner">
          <span className="badge">N=1 Collaborative</span>
          <h1>Therapeutic Genome-Editing Workflow</h1>
          <p className="subtitle">
            An interactive walkthrough of the framework for assessing pathogenic
            variants for gene-editing therapy.
          </p>
        </div>
      </header>

      <main className="container">
        {mode === null && (
          <>
            <IntroCard />
            <ModeChooser onPick={chooseMode} />
          </>
        )}

        {mode !== null && (
          <div className="mode-bar">
            <span className="mode-current">
              {mode === "hgvs" ? "① Start from a variant" : "② Answer the flowchart"}
            </span>
            <button className="btn ghost small-btn" onClick={restart}>
              ← Restart
            </button>
          </div>
        )}

        {mode === "hgvs" && (
          <HgvsPanel
            value={hgvsInput}
            onChange={setHgvsInput}
            onSubmit={handleParse}
            error={hgvsError}
            summary={parseSummary}
            onUseRecommendation={(modality) => {
              const a =
                modality === "base"
                  ? "Transition → Base editing"
                  : "Transversion / indel → Prime editing";
              jumpTo(MODALITY_TO_TERMINAL[modality], "Suggested from parsed variant", a);
            }}
            onSwitchToFlowchart={() => chooseMode("flowchart")}
            onPickExample={pickExample}
          />
        )}

        {started && (
          <section className="wizard">
            {history.length > 0 && <Breadcrumb history={history} />}

            {current.terminal ? (
              <Terminal node={current} onJump={jumpTo} />
            ) : (
              <Question node={current} onChoose={choose} />
            )}

            <div className="controls">
              <button
                className="btn ghost"
                onClick={back}
                disabled={history.length === 0}
              >
                ← Back
              </button>
              <button className="btn ghost" onClick={restart}>
                Restart
              </button>
              {current.terminal && current.kind !== "outofscope" && (
                <button className="btn primary" onClick={() => setShowVaf((v) => !v)}>
                  📋 {showVaf ? "Hide" : "Generate"} assessment form
                </button>
              )}
            </div>
          </section>
        )}

        {started && showVaf && current.terminal && (
          <VariantAssessmentForm
            variant={mode === "hgvs" ? parseSummary : null}
            history={history}
            terminal={current}
          />
        )}
      </main>

      <footer className="site-footer">
        <p>
          Decision logic adapted from the N=1 Collaborative "A framework for
          molecular assessment of pathogenic variants for gene editing therapy."
          For research and prioritization support only — not a treatment
          recommendation.
        </p>
      </footer>
    </div>
  );
}

function IntroCard() {
  return (
    <section className="card intro">
      <h2>Before you begin</h2>
      <ul className="checklist">
        <li>Confirm variant identity and pathogenic/likely-pathogenic status.</li>
        <li>Prioritize conventional medical and genetic therapies first.</li>
        <li>
          Scope: single-nucleotide variants and small insertions/deletions
          (&lt;10&nbsp;bp) in monogenic disorders.
        </li>
      </ul>
    </section>
  );
}

function ModeChooser({ onPick }) {
  return (
    <section className="chooser">
      <h2 className="chooser-title">Choose how to start</h2>
      <div className="chooser-grid">
        <button className="choice-card" onClick={() => onPick("hgvs")}>
          <span className="choice-num">①</span>
          <span className="choice-icon">🧬</span>
          <span className="choice-head">Start from a variant</span>
          <span className="choice-body">
            Enter an HGVS <code>c.</code> variant. It’s parsed and classified, the
            reference sequence is shown, and a base- or prime-editing suggestion
            is seeded automatically.
          </span>
          <span className="choice-go">Enter a variant →</span>
        </button>

        <button className="choice-card" onClick={() => onPick("flowchart")}>
          <span className="choice-num">②</span>
          <span className="choice-icon">🗺️</span>
          <span className="choice-head">Answer the flowchart</span>
          <span className="choice-body">
            Walk the decision tree by answering questions about
            inheritance, allele knockout, and variant class to reach a
            recommended editing strategy.
          </span>
          <span className="choice-go">Answer questions →</span>
        </button>
      </div>
    </section>
  );
}

const HGVS_EXAMPLES = [
  { label: "DMD c.9445C>T", hgvs: "NM_004006.3(DMD):c.9445C>T", note: "transition → base" },
  { label: "RHO c.68C>A", hgvs: "NM_000539.3(RHO):c.68C>A", note: "transversion → prime" },
  { label: "CPS1 c.1003C>T", hgvs: "NM_001875.5(CPS1):c.1003C>T", note: "biallelic → base" },
  { label: "HEXA c.1274_1277dup", hgvs: "NM_000520.6(HEXA):c.1274_1277dup", note: "duplication → prime" },
];

function HgvsPanel({ value, onChange, onSubmit, error, summary, onUseRecommendation, onSwitchToFlowchart, onPickExample }) {
  return (
    <section className="card hgvs">
      <h2>Start from a variant</h2>
      <p className="muted">
        Enter an HGVS <code>c.</code> variant to auto-classify it, view the
        reference sequence, and seed an editing-modality suggestion — or{" "}
        <button type="button" className="linklike" onClick={onSwitchToFlowchart}>
          answer the flowchart questions instead
        </button>
        .
      </p>
      <form className="hgvs-form" onSubmit={onSubmit}>
        <input
          className="hgvs-input"
          type="text"
          value={value}
          placeholder="e.g. NM_000539.3(RHO):c.68C>A"
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button className="btn primary" type="submit">
          Parse
        </button>
      </form>

      <div className="examples">
        <span className="examples-label">Examples:</span>
        {HGVS_EXAMPLES.map((ex) => (
          <button
            key={ex.hgvs}
            type="button"
            className="example-btn"
            title={`${ex.hgvs} — ${ex.note}`}
            onClick={() => onPickExample(ex.hgvs)}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {error && <div className="alert error">⚠ {error}</div>}

      {summary && (
        <div className="parse-result">
          <div className="parse-grid">
            <Field label="Transcript">
              {summary.transcript}
              <span className="tag">{summary.isNM ? "NM accession" : "gene symbol"}</span>
            </Field>
            <Field label="Variant">{summary.desc}</Field>
            <Field label="Variant class">
              <span className={`pill pill-${summary.suggestedModality}`}>
                {summary.variantClass}
              </span>
            </Field>
            <Field label="Type">{summary.isSNV ? "SNV" : "small indel"}</Field>
          </div>
          <p className="parse-note">{summary.note}</p>
          <button
            className="btn primary"
            onClick={() => onUseRecommendation(summary.suggestedModality)}
          >
            Use suggested modality:{" "}
            {summary.suggestedModality === "base" ? "Base editing" : "Prime editing"} →
          </button>
          <p className="muted small">
            Note: this shortcut assumes direct correction. Use the questions
            above for dominant / knockout / non-corrective paths.
          </p>
          <SequenceView key={summary.input} input={summary.input} />
        </div>
      )}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">{children}</div>
    </div>
  );
}

function Breadcrumb({ history }) {
  return (
    <ol className="breadcrumb">
      {history.map((h, i) => (
        <li key={i}>
          <span className="crumb-q">{h.q}</span>
          <span className="crumb-a">{h.a}</span>
        </li>
      ))}
    </ol>
  );
}

function Question({ node, onChoose }) {
  return (
    <div className="card question">
      <h2>{node.title}</h2>
      {node.help && <p className="muted">{node.help}</p>}
      <div className="options">
        {node.options.map((opt) => (
          <button key={opt.label} className="option" onClick={() => onChoose(opt)}>
            <span className="option-label">{opt.label}</span>
            {opt.help && <span className="option-help">{opt.help}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Terminal({ node, onJump }) {
  return (
    <div className={`card terminal terminal-${node.kind}`}>
      <div className="terminal-head">
        <span className="terminal-kicker">Recommended approach</span>
        <h2>{node.title}</h2>
      </div>
      <p className="terminal-summary">{node.summary}</p>

      {node.considerations && (
        <ul className="considerations">
          {node.considerations.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}

      {node.note && <p className="terminal-note">{node.note}</p>}

      {node.cta && (
        <a className="btn primary cta" href={node.cta.url} target="_blank" rel="noreferrer">
          {node.cta.label} ↗
        </a>
      )}

      {node.override && (
        <button
          className="btn ghost override"
          onClick={() => onJump(node.override.next, "Base editing", "Switched to prime editing")}
        >
          {node.override.label}
        </button>
      )}
    </div>
  );
}
