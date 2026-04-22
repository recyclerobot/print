import './style.css';
import { store } from './store';
import { Renderer } from './webgl/renderer';
import { attachInteraction } from './interaction';
import { buildToolbar } from './ui/toolbar';
import { buildPagesPanel } from './ui/pagesPanel';
import { buildPropertiesPanel } from './ui/propertiesPanel';
import { createRulers } from './ui/rulers';

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="layout">
    <header class="topbar" id="toolbar"></header>
    <aside class="left-panel" id="pages"></aside>
    <main class="canvas-host" id="canvasHost">
      <canvas id="canvas" tabindex="0"></canvas>
    </main>
    <aside class="right-panel" id="props"></aside>
    <footer class="statusbar" id="status"></footer>
  </div>
`;

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const canvasHost = document.getElementById('canvasHost')!;
const renderer = new Renderer(canvas);
renderer.setDocument(store.doc, store.currentPageId, store.selectedIds);
renderer.showGrid = store.prefs.showGrid;
renderer.showMargins = store.prefs.showMargins;
renderer.showBleed = store.prefs.showBleed;

let pending = false;
function requestRender(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    renderer.setDocument(store.doc, store.currentPageId, store.selectedIds);
    renderer.render();
    rulers.draw();
    updateStatus();
  });
}

const rulers = createRulers(canvasHost, renderer);
attachInteraction(canvas, renderer, requestRender);

buildToolbar(document.getElementById('toolbar')!, renderer, requestRender);
buildPagesPanel(document.getElementById('pages')!, renderer, requestRender);
buildPropertiesPanel(document.getElementById('props')!, renderer, requestRender);

window.addEventListener('resize', () => requestRender());
store.subscribe(() => requestRender());

function updateStatus(): void {
  const status = document.getElementById('status')!;
  const sel = store.selected();
  const z = (renderer.view.zoom * 25.4 / 96 * 100).toFixed(0);
  const pageIdx = store.doc.pages.findIndex(p => p.id === store.currentPageId);
  const sizeCm = `${(store.doc.size.width / 10).toFixed(1)}×${(store.doc.size.height / 10).toFixed(1)} cm`;
  let info = `Page ${pageIdx + 1}/${store.doc.pages.length} · ${sizeCm} · zoom ${z}% · unit ${store.prefs.unit}`;
  if (sel.length === 1) {
    const e = sel[0];
    info += ` · ${e.type} ${e.width.toFixed(1)}×${e.height.toFixed(1)}mm @ (${e.x.toFixed(1)}, ${e.y.toFixed(1)})`;
  } else if (sel.length > 1) {
    info += ` · ${sel.length} selected`;
  }
  status.textContent = info;
}

// Initial fit + render
requestAnimationFrame(() => {
  renderer.fitToScreen();
  requestRender();
});
