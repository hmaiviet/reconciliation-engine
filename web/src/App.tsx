import { useState, type FormEvent } from 'react';
import { formatManual, type PinRow } from '../../src/csv/format';
import { formatInputError, type InputError, type MatchKind } from '../../src/domain/types';
import type { ReconcileOutput } from '../../src/pipeline';
import { serializeReport, type Echo, type Report } from '../../src/report/report';

interface Loaded {
  name: string;
  text: string;
}

type Side = 'ours' | 'theirs';
const KINDS: MatchKind[] = ['manual', 'exact', 'rule_based', 'fuzzy'];
const KIND_LABEL: Record<MatchKind, string> = { manual: 'Manual', exact: 'Exact', rule_based: 'Rule-based', fuzzy: 'Fuzzy' };
const SIDE_LABEL: Record<Side, string> = { ours: 'Ours', theirs: 'Theirs' };
const NUMERIC = new Set(['amount', 'quantity', 'price_per_share', 'fx_rate']);
const TILES: [keyof Report['summary'], string, string][] = [
  ['matched_manual', 'Manual', 'manual'],
  ['matched_exact', 'Exact', 'exact'],
  ['matched_rule_based', 'Rule-based', 'rule_based'],
  ['matched_fuzzy', 'Fuzzy', 'fuzzy'],
  ['unmatched_ours', 'Unmatched ours', 'unmatched'],
  ['unmatched_theirs', 'Unmatched theirs', 'unmatched'],
];

export function App() {
  const [ours, setOurs] = useState<Loaded | null>(null);
  const [theirs, setTheirs] = useState<Loaded | null>(null);
  // A chosen manual.csv replaces the pin list on the next run (D9).
  const [manualFile, setManualFile] = useState<Loaded | null>(null);
  const [asOf, setAsOf] = useState('');
  const [amountTol, setAmountTol] = useState('0.01');
  const [secondsTol, setSecondsTol] = useState('1');
  const [pins, setPins] = useState<PinRow[]>([]);
  const [result, setResult] = useState<ReconcileOutput | null>(null);
  const [runCount, setRunCount] = useState(0);
  const [errors, setErrors] = useState<InputError[]>([]);
  const [running, setRunning] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!ours || !theirs) return;
    setRunning(true);
    setErrors([]);
    try {
      const res = await fetch('/reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ours: ours.text,
          theirs: theirs.text,
          manual: manualFile?.text ?? formatManual(pins),
          as_of: asOf,
          tolerances: { amount: amountTol, seconds: secondsTol },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrors(body.errors ?? [{ message: `request failed with HTTP ${res.status}` }]);
        return;
      }
      setResult(body);
      setRunCount((n) => n + 1);
      setPins(body.pins);
      setManualFile(null);
    } catch (err) {
      setErrors([{ message: `could not reach the API: ${(err as Error).message}` }]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main>
      <header className="masthead">
        <h1>Reconciliation</h1>
        <p className="muted">Pins live in this tab only. Download manual.csv to keep them.</p>
      </header>

      <form className="card" onSubmit={run} aria-label="Inputs">
        <fieldset>
          <legend>Files</legend>
          <FileField label="Ours CSV" loaded={ours !== null} onLoad={setOurs} />
          <FileField label="Theirs CSV" loaded={theirs !== null} onLoad={setTheirs} />
          {/* Remounted per run: a consumed manual file is replaced by the pin list below. */}
          <FileField key={runCount} label="Manual CSV (optional)" loaded={manualFile !== null} onLoad={setManualFile} />
        </fieldset>
        <fieldset>
          <legend>Settings</legend>
          <label className="field">
            Cutoff (UTC)
            <input
              type="text"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              placeholder="2026-04-01T23:59:59.999Z"
              aria-describedby="as-of-hint"
            />
            <small id="as-of-hint" className="muted">
              YYYY-MM-DDTHH:MM:SS[.sss]Z. Records after the cutoff are ignored.
            </small>
          </label>
          <label className="field">
            Amount tolerance
            <input type="text" inputMode="decimal" value={amountTol} onChange={(e) => setAmountTol(e.target.value)} />
          </label>
          <label className="field">
            Time tolerance (seconds)
            <input type="text" inputMode="decimal" value={secondsTol} onChange={(e) => setSecondsTol(e.target.value)} />
          </label>
        </fieldset>
        <div className="actions">
          {(!ours || !theirs) && <span className="muted">Choose the ours and theirs files to run.</span>}
          <button type="submit" className="primary" disabled={running || !ours || !theirs} aria-busy={running}>
            {running ? 'Running…' : 'Run reconciliation'}
          </button>
        </div>
      </form>

      {errors.length > 0 && (
        <div role="alert" className="callout errors">
          <h2>Fix these inputs and run again</h2>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{formatInputError(e)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Keyed per run so a selection never points at a record from an older result. */}
      {result && <Results key={runCount} result={result} pins={pins} setPins={setPins} manualPending={manualFile !== null} />}
    </main>
  );
}

function FileField({ label, loaded, onLoad }: { label: string; loaded: boolean; onLoad: (f: Loaded | null) => void }) {
  return (
    <label className="field file" data-loaded={loaded}>
      {label}
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          onLoad(file ? { name: file.name, text: await file.text() } : null);
        }}
      />
    </label>
  );
}

function Results({
  result,
  pins,
  setPins,
  manualPending,
}: {
  result: ReconcileOutput;
  pins: PinRow[];
  setPins: (p: PinRow[]) => void;
  manualPending: boolean;
}) {
  const { report, records, tolerances, warnings } = result;
  const [pick, setPick] = useState<Partial<Record<Side, string>>>({});
  const [unmatchedOnly, setUnmatchedOnly] = useState(true);

  const byId = { ours: new Map(records.ours.map((r) => [String(r.id), r])), theirs: new Map(records.theirs.map((r) => [String(r.id), r])) };
  const status = { ours: new Map<string, Status>(), theirs: new Map<string, Status>() };
  for (const m of report.matches) {
    status.ours.set(m.ours_id, { kind: m.kind, partner: m.theirs_id });
    status.theirs.set(m.theirs_id, { kind: m.kind, partner: m.ours_id });
  }
  const pinned = { ours: new Map(pins.map((p) => [p.ours_id, p.theirs_id])), theirs: new Map(pins.map((p) => [p.theirs_id, p.ours_id])) };
  const pinsChanged = JSON.stringify(pins) !== JSON.stringify(result.pins);

  function addPin() {
    if (!pick.ours || !pick.theirs) return;
    setPins([...pins, { ours_id: pick.ours, theirs_id: pick.theirs }]);
    setPick({});
  }

  return (
    <section aria-label="Results" className="results">
      <div className="section-head">
        <div>
          <h2>Results</h2>
          <p className="muted">
            As of <code>{report.as_of}</code> · amount ±{tolerances.amount} · time ±{tolerances.seconds} s
          </p>
        </div>
        <div className="exports">
          <button type="button" onClick={() => download('report.json', serializeReport(report), 'application/json')}>
            Download report.json
          </button>
          <button type="button" onClick={() => download('manual.csv', formatManual(pins), 'text/csv')}>
            Download manual.csv
          </button>
        </div>
      </div>

      <div className="card">
        <dl className="tally" aria-label="Summary">
          {TILES.map(([key, label, tone]) => (
            <div key={key} className={`tile tone-${tone}`}>
              <dt>{label}</dt>
              <dd>{report.summary[key]}</dd>
            </div>
          ))}
        </dl>
        <Coverage report={report} />
      </div>

      {warnings.length > 0 && (
        <div className="callout warnings" role="status">
          <h3>Skipped manual pins</h3>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{formatInputError(w)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>Matches</h3>
        {report.matches.length === 0 && <p className="muted">No matches. Pin records below to match them by hand.</p>}
        {KINDS.map((kind) => {
          const ms = report.matches.filter((m) => m.kind === kind);
          if (ms.length === 0) return null;
          return (
            <section key={kind} aria-label={`${kind} matches`} className="match-group">
              <h4>
                <span className={`badge tone-${kind}`}>{KIND_LABEL[kind]}</span> <span className="muted">{ms.length}</span>
              </h4>
              {ms.map((m) => (
                <details key={m.ours_id} className="match">
                  <summary>
                    <span>
                      {m.ours_id} ↔ {m.theirs_id}
                    </span>
                    <span className={diffClass(m.amount_diff)}>Δ amount {m.amount_diff}</span>
                    <span className={diffClass(m.timestamp_diff_seconds)}>Δ time {m.timestamp_diff_seconds} s</span>
                  </summary>
                  <FieldTable ours={byId.ours.get(m.ours_id)} theirs={byId.theirs.get(m.theirs_id)} />
                </details>
              ))}
            </section>
          );
        })}
      </div>

      <div className="card">
        <h3>Manual pins</h3>
        {manualPending && <p className="note">A manual.csv is selected: its pins replace this list on the next run.</p>}
        {pinsChanged && <p className="note">Pins changed since the last run. Run again to apply them.</p>}
        {pins.length === 0 ? (
          <p className="muted">No pins yet. Select one record on each side below, then pin them.</p>
        ) : (
          <ul aria-label="Pins" className="pins">
            {pins.map((p) => (
              <li key={`${p.ours_id}\n${p.theirs_id}`}>
                {p.ours_id} ↔ {p.theirs_id}
                <button
                  type="button"
                  disabled={manualPending}
                  aria-label={`Remove pin ${p.ours_id} ↔ ${p.theirs_id}`}
                  title="Remove pin"
                  onClick={() => setPins(pins.filter((q) => q !== p))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <h3>Records</h3>
            <p className="muted">Click a record on each side, then pin them. Records that already have a pin can't be selected.</p>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={unmatchedOnly} onChange={(e) => setUnmatchedOnly(e.target.checked)} /> Unmatched only
          </label>
        </div>
        <div className="pinbar">
          <span>
            Selected <code>{pick.ours ?? '—'}</code> ↔ <code>{pick.theirs ?? '—'}</code>
          </span>
          <button type="button" className="primary" disabled={!pick.ours || !pick.theirs || manualPending} onClick={addPin}>
            Pin selected pair{pick.ours || pick.theirs ? ` (${pick.ours ?? '?'} ↔ ${pick.theirs ?? '?'})` : ''}
          </button>
        </div>
        <div className="records">
          {(['ours', 'theirs'] as const).map((side) => (
            <RecordTable
              key={side}
              side={side}
              records={records[side].filter((r) => !unmatchedOnly || !status[side].has(String(r.id)))}
              status={status[side]}
              pinned={pinned[side]}
              selected={pick[side]}
              onSelect={(id) => setPick({ ...pick, [side]: id })}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

interface Status {
  kind: MatchKind;
  partner: string;
}

/** One bar per side: how its eligible records split across tiers and unmatched. */
function Coverage({ report }: { report: Report }) {
  const counts = KINDS.map((k) => [k, report.matches.filter((m) => m.kind === k).length] as const);
  const matched = report.matches.length;
  return (
    <div className="bars">
      {(['ours', 'theirs'] as const).map((side) => {
        const unmatched = report.summary[`unmatched_${side}`];
        const total = matched + unmatched;
        return (
          <div key={side} className="bar-row">
            <span>{SIDE_LABEL[side]}</span>
            <div className="bar" role="img" aria-label={`${SIDE_LABEL[side]}: ${matched} of ${total} records matched`}>
              {counts.map(
                ([k, n]) => n > 0 && <span key={k} className={`seg tone-${k}`} style={{ flexGrow: n }} title={`${KIND_LABEL[k]}: ${n}`} />,
              )}
              {unmatched > 0 && <span className="seg tone-unmatched" style={{ flexGrow: unmatched }} title={`Unmatched: ${unmatched}`} />}
            </div>
            <span className="muted">
              {matched} of {total} matched
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RecordTable({
  side,
  records,
  status,
  pinned,
  selected,
  onSelect,
}: {
  side: Side;
  records: Echo[];
  status: Map<string, Status>;
  pinned: Map<string, string>;
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  const columns = records[0] ? Object.keys(records[0]).filter((c) => c !== 'id') : [];
  return (
    <div className="table-wrap">
      <table>
        <caption>{SIDE_LABEL[side]}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Select</span>
            </th>
            <th scope="col">id</th>
            <th scope="col">Status</th>
            {columns.map((c) => (
              <th scope="col" key={c} className={NUMERIC.has(c) ? 'num' : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr>
              <td colSpan={columns.length + 3} className="text muted">
                No records.
              </td>
            </tr>
          )}
          {records.map((r) => {
            const id = String(r.id);
            const partner = pinned.get(id);
            const s = status.get(id);
            return (
              <tr
                key={id}
                className={partner !== undefined ? 'locked' : selected === id ? 'selected' : undefined}
                onClick={() => partner === undefined && onSelect(id)}
              >
                <td>
                  <input
                    type="radio"
                    name={`${side}-pick`}
                    aria-label={`Select ${side} ${id}`}
                    checked={selected === id}
                    disabled={partner !== undefined}
                    onChange={() => onSelect(id)}
                  />
                </td>
                <td>{id}</td>
                <td className="status">
                  {s ? (
                    <>
                      <span className={`badge tone-${s.kind}`}>{KIND_LABEL[s.kind]}</span> <code>{s.partner}</code>
                    </>
                  ) : (
                    <span className="badge tone-unmatched">Unmatched</span>
                  )}
                  {partner !== undefined && <span className="badge tone-manual">Pinned to {partner}</span>}
                </td>
                {columns.map((c) => (
                  <td key={c} className={NUMERIC.has(c) ? 'num' : c === 'memo' ? 'text' : undefined}>
                    {r[c]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldTable({ ours, theirs }: { ours: Echo | undefined; theirs: Echo | undefined }) {
  const fields = [...new Set([...Object.keys(ours ?? {}), ...Object.keys(theirs ?? {})])];
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">field</th>
            <th scope="col">ours</th>
            <th scope="col">theirs</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f} className={f !== 'id' && ours?.[f] !== theirs?.[f] ? 'differs' : undefined}>
              <th scope="row">{f}</th>
              <td className={f === 'memo' ? 'text' : undefined}>{ours?.[f] ?? ''}</td>
              <td className={f === 'memo' ? 'text' : undefined}>{theirs?.[f] ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const diffClass = (d: string) => (/^0\.0+$/.test(d) ? 'diff' : 'diff off');

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url));
}
