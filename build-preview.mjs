// prototypes/veil-standard-pattern/build-preview.mjs
// Bundles the real pattern-core / shape-paths / presets / exporters sources plus
// preview-ui.js into a single self-contained preview.html that opens off disk -
// no server, no npm install, no React.
//
//   node prototypes/veil-standard-pattern/build-preview.mjs
//
// It strips `export ` and `import ...` lines rather than re-implementing
// anything, so the harness cannot drift from the engine the React component
// and the smoke test use. preview.html is GENERATED - edit the sources.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');

const flatten = (src) =>
  src
    .split('\n')
    .filter((l) => !/^\s*import\s.*from\s/.test(l) && !/^\s*import\s+'/.test(l))
    .map((l) =>
      l
        .replace(/^export\s+default\s+/, '')
        .replace(/^export\s+(?=(async\s+)?(const|function|let|class)\s)/, '')
    )
    .join('\n');

const core = ['pattern-core.js', 'shape-paths.js', 'presets.js', 'exporters.js']
  .map((f) => `// ===== ${f} =====\n${flatten(read(f))}`)
  .join('\n\n');

const ui = flatten(read('preview-ui.js'));

const css = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: grid; grid-template-columns: minmax(0,1fr) 296px;
         font: 13px/1.4 Inter, "Helvetica Neue", Arial, sans-serif; color: #0e0f11; background: #f6f5f2; }
  main { display: flex; flex-direction: column; min-width: 0; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 20px 10px;
           border-bottom: 1px solid rgba(0,0,0,.08); }
  h1 { font-size: 12px; letter-spacing: .22em; text-transform: uppercase; font-weight: 500; margin: 0; }
  #meta, #stats { font-size: 11px; opacity: .6; font-variant-numeric: tabular-nums; }
  #stagewrap { flex: 1; min-height: 0; position: relative; }
  #stage { position: absolute; inset: 0; padding: 10px 20px 0; overflow: auto; }
  #stage svg { display: block; margin: 0 auto; }
  /* Floating zoom pill, centred over the canvas - mirrors spectRAL bottom-bar. */
  #zoombar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
             display: flex; align-items: center; gap: 8px; padding: 6px 14px;
             background: rgba(255,254,251,.94); border: 1px solid rgba(0,0,0,.14);
             border-radius: 999px; box-shadow: 0 2px 10px rgba(0,0,0,.09);
             font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
             color: rgba(0,0,0,.45); z-index: 5; }
  #zoombar input { width: 150px; accent-color: #6b6321; height: 2px; }
  #zoomVal { font-variant-numeric: tabular-nums; min-width: 34px; text-align: right;
             font-size: 11px; letter-spacing: 0; color: rgba(0,0,0,.7); }
  #zoomFit { border: 0; background: none; cursor: pointer; font: inherit;
             color: rgba(0,0,0,.45); text-transform: uppercase; letter-spacing: .14em; }
  #zoomFit:hover { color: rgba(0,0,0,.8); }
  footer { display: flex; align-items: center; gap: 16px; padding: 12px 20px;
           border-top: 1px solid rgba(0,0,0,.08); flex-wrap: wrap; }
  #warn { display: none; margin: 10px 20px 0; padding: 8px 11px; font-size: 12px;
          border: 1px solid rgba(180,60,20,.4); background: rgba(200,80,30,.07); border-radius: 3px; }
  aside { border-left: 1px solid rgba(0,0,0,.1); background: #fffefb; padding: 14px 16px 60px; overflow-y: auto; }
  .grp { font-size: 9px; letter-spacing: .16em; text-transform: uppercase; opacity: .4; margin: 16px 0 4px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 0; }
  .row.stack { flex-wrap: wrap; }
  .edge { margin: 8px 20px 0; padding: 7px 10px; font-size: 11.5px; line-height: 1.45;
           border-radius: 3px; border: 1px solid transparent; }
  .edge.ok { color: rgba(0,0,0,.5); border-color: rgba(0,0,0,.09); background: rgba(0,0,0,.02); }
  .edge.warn { color: #7a4410; border-color: rgba(180,110,20,.35); background: rgba(210,140,40,.09); }
  .edge button.fix { margin-left: 8px; font: inherit; font-weight: 600; padding: 2px 10px;
    border: 1px solid rgba(180,110,20,.5); border-radius: 4px; background: #fff; color: #7a4410;
    cursor: pointer; }
  .edge button.fix:hover { background: rgba(210,140,40,.14); }
  .importbtn { font: inherit; font-size: 11px; padding: 3px 8px; cursor: pointer;
        border: 1px solid rgba(0,0,0,.25); border-radius: 3px; background: #f6f5f1; }
  .importbtn:hover { background: #ecebe5; }
  .storewhere { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
  .storewhere.ok { color: rgba(0,0,0,.4); }
  .storewhere.warn { color: #7a4410; }
  .saveblk { display: flex; align-items: center; gap: 6px; }
  .saveblk input[type=text] { width: 120px; font: inherit; font-size: 11px; padding: 3px 6px;
        border: 1px solid rgba(0,0,0,.18); border-radius: 3px; background: #fff; }
  .saveblk select { font: inherit; font-size: 11px; max-width: 150px; }
  input.swatch { width: 42px; height: 20px; padding: 0; border: 1px solid rgba(0,0,0,.2);
        border-radius: 3px; background: none; cursor: pointer; }
  .veil-tip { position: fixed; z-index: 40; max-width: 270px; pointer-events: none;
              padding: 8px 10px; border-radius: 4px; font-size: 11.5px; line-height: 1.45;
              letter-spacing: 0; text-transform: none;
              background: #24221c; color: #f6f4ee; box-shadow: 0 4px 16px rgba(0,0,0,.22);
              opacity: 0; transition: opacity .12s ease; }
  .veil-tip.show { opacity: 1; }
  .row[data-tip] { cursor: help; }
  .valwrap { display: inline-flex; align-items: baseline; gap: 3px; }
  /* Typable value: reads as text until focused, so the rail stays calm. */
  input.val { width: 52px; text-align: right; font: inherit; font-size: 11px;
              font-variant-numeric: tabular-nums; color: rgba(0,0,0,.75);
              background: transparent; border: 1px solid transparent;
              border-radius: 3px; padding: 1px 3px; }
  input.val:hover { border-color: rgba(0,0,0,.15); }
  input.val:focus { outline: none; border-color: #6b6321; background: #fff;
                    color: #000; }
  input.val::-webkit-outer-spin-button,
  input.val::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  input.val { -moz-appearance: textfield; }
  .valwrap .unit { font-size: 10px; opacity: .45; }
  .row.stack input[type=range] { flex: 1 0 100%; }
  .lab { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; opacity: .62; }
  .val { font-size: 11px; font-variant-numeric: tabular-nums; opacity: .85; }
  select { width: 132px; font: inherit; font-size: 12px; padding: 3px 5px; background: transparent;
           border: 1px solid rgba(0,0,0,.25); border-radius: 3px; }
  button { font: inherit; font-size: 10px; letter-spacing: .09em; text-transform: uppercase;
           padding: 6px 11px; background: #0e0f11; color: #f6f5f2; border: 0; border-radius: 3px; cursor: pointer; }
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VEIL standard pattern - preview harness</title>
<style>${css}</style>
</head>
<body>
<main>
  <header>
    <h1>VEIL / standard pattern</h1>
    <span id="meta"></span>
  </header>
  <div id="warn"></div>
  <div id="edge" class="edge ok"></div>
  <div id="cont" class="edge ok"></div>
  <div id="alias" class="edge ok"></div>
  <div id="stagewrap">
    <div id="stage"></div>
    <div id="zoombar">
      <label for="zoomSlider">Zoom</label>
      <input type="range" id="zoomSlider" min="25" max="400" step="5" value="100">
      <span id="zoomVal">100%</span>
      <button id="zoomFit" type="button">Fit</button>
    </div>
  </div>
  <footer>
    <span class="saveblk">
      <input id="saveName" type="text" placeholder="design name" spellcheck="false">
      <button id="btnSave">save</button>
      <select id="savedList"></select>
      <button id="btnDelete">delete</button>
      <button id="btnExportAll">export</button>
      <label class="importbtn">import<input id="btnImportAll" type="file" accept="application/json,.json" hidden></label>
      <span id="storeWhere" class="storewhere"></span>
    </span>
    <span id="stats"></span>
    <span style="margin-left:auto;display:flex;gap:7px">
      <button id="x-svg">svg</button>
      <button id="x-dxf">dxf</button>
      <button id="x-json">payload</button>
      <button id="x-rec">recipe</button>
    </span>
  </footer>
</main>
<aside id="rail"></aside>
<script>
${core}

${ui}
</script>
</body>
</html>
`;

writeFileSync(join(here, 'preview.html'), html, 'utf8');
console.log('wrote preview.html', html.length, 'bytes');
