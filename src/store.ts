import type {
  PrintDocument, Page, AnyElement, Template, TextElement,
  ImageElement, RectElement, PageSize,
} from './types';
import { A_SIZES } from './types';

const STORAGE_KEY = 'print.document.v1';
const PREFS_KEY = 'print.prefs.v1';

export interface Prefs {
  unit: 'mm' | 'cm' | 'in' | 'pt';
  showRulers: boolean;
  showGuides: boolean;
  showMargins: boolean;
  showBleed: boolean;
  snapEnabled: boolean;
  snapTolerance: number; // px on screen
  gridSize: number; // mm
  showGrid: boolean;
}

export const defaultPrefs: Prefs = {
  unit: 'cm',
  showRulers: true,
  showGuides: true,
  showMargins: true,
  showBleed: true,
  snapEnabled: true,
  snapTolerance: 8,
  gridSize: 10,
  showGrid: false,
};

function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newTextElement(partial: Partial<TextElement> = {}): TextElement {
  return {
    id: uid('txt'),
    type: 'text',
    x: 20, y: 20, width: 80, height: 20,
    rotation: 0, opacity: 1,
    text: 'New text',
    fontFamily: 'Helvetica, Arial, sans-serif',
    fontSize: 18,
    fontWeight: 400,
    italic: false,
    color: '#111111',
    lineHeight: 1.2,
    letterSpacing: 0,
    align: 'left',
    vAlign: 'top',
    ...partial,
  };
}

export function newRectElement(partial: Partial<RectElement> = {}): RectElement {
  return {
    id: uid('rct'),
    type: 'rect',
    x: 20, y: 20, width: 60, height: 40,
    rotation: 0, opacity: 1,
    fill: '#3a86ff',
    stroke: '#000000',
    strokeWidth: 0,
    cornerRadius: 0,
    ...partial,
  };
}

export function newImageElement(partial: Partial<ImageElement> & Pick<ImageElement, 'src'>): ImageElement {
  return {
    id: uid('img'),
    type: 'image',
    x: 20, y: 20, width: 80, height: 60,
    rotation: 0, opacity: 1,
    fit: 'contain',
    ...partial,
  };
}

export function newPage(name = `Page`): Page {
  return {
    id: uid('pg'),
    name,
    elements: [],
    background: '#ffffff',
  };
}

export function newTemplate(name = 'Template', elements: AnyElement[] = []): Template {
  return {
    id: uid('tpl'),
    name,
    elements: elements.map(e => ({ ...e, id: uid(e.type.slice(0, 3)) })),
    background: '#ffffff',
  };
}

export function newDocument(size: PageSize = A_SIZES.A4): PrintDocument {
  const now = Date.now();
  const page = newPage('Page 1');
  return {
    id: uid('doc'),
    name: 'Untitled Document',
    size,
    margins: { top: 15, right: 15, bottom: 15, left: 15 },
    bleed: { top: 3, right: 3, bottom: 3, left: 3 },
    pages: [page],
    templates: [],
    createdAt: now,
    updatedAt: now,
  };
}

type Listener = () => void;

class Store {
  doc: PrintDocument;
  prefs: Prefs;
  currentPageId: string;
  selectedIds: Set<string> = new Set();
  private listeners: Set<Listener> = new Set();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private suspendHistory = false;

  constructor() {
    this.doc = this.loadDoc();
    this.prefs = this.loadPrefs();
    this.currentPageId = this.doc.pages[0].id;
  }

  private loadDoc(): PrintDocument {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as PrintDocument;
    } catch { /* ignore */ }
    return newDocument();
  }
  private loadPrefs(): Prefs {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) return { ...defaultPrefs, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { ...defaultPrefs };
  }

  save(): void {
    this.doc.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
    localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  emit(): void {
    this.save();
    this.listeners.forEach(l => l());
  }

  // History
  pushHistory(): void {
    if (this.suspendHistory) return;
    this.undoStack.push(JSON.stringify(this.doc));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.doc));
    const prev = this.undoStack.pop()!;
    this.doc = JSON.parse(prev);
    this.ensureCurrentPage();
    this.emit();
  }
  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.doc));
    const next = this.redoStack.pop()!;
    this.doc = JSON.parse(next);
    this.ensureCurrentPage();
    this.emit();
  }
  transact(fn: () => void): void {
    this.pushHistory();
    this.suspendHistory = true;
    try { fn(); } finally { this.suspendHistory = false; }
    this.emit();
  }

  ensureCurrentPage(): void {
    if (!this.doc.pages.find(p => p.id === this.currentPageId)) {
      this.currentPageId = this.doc.pages[0]?.id ?? '';
    }
  }

  // Page operations
  get currentPage(): Page | undefined {
    return this.doc.pages.find(p => p.id === this.currentPageId);
  }
  setCurrentPage(id: string): void {
    this.currentPageId = id;
    this.selectedIds.clear();
    this.emit();
  }
  addPage(templateId?: string): Page {
    const tpl = templateId ? this.doc.templates.find(t => t.id === templateId) : undefined;
    const page = newPage(`Page ${this.doc.pages.length + 1}`);
    if (tpl) {
      page.templateId = tpl.id;
      page.background = tpl.background;
      page.elements = tpl.elements.map(e => ({ ...e, id: `${e.type.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}` }));
    }
    this.transact(() => { this.doc.pages.push(page); });
    this.currentPageId = page.id;
    this.emit();
    return page;
  }
  deletePage(id: string): void {
    if (this.doc.pages.length <= 1) return;
    this.transact(() => {
      this.doc.pages = this.doc.pages.filter(p => p.id !== id);
    });
    this.ensureCurrentPage();
    this.emit();
  }
  movePage(id: string, delta: number): void {
    const idx = this.doc.pages.findIndex(p => p.id === id);
    if (idx < 0) return;
    const target = Math.max(0, Math.min(this.doc.pages.length - 1, idx + delta));
    if (target === idx) return;
    this.transact(() => {
      const [pg] = this.doc.pages.splice(idx, 1);
      this.doc.pages.splice(target, 0, pg);
    });
  }

  // Template operations
  saveAsTemplate(name: string): Template | undefined {
    const page = this.currentPage;
    if (!page) return;
    const tpl = newTemplate(name, page.elements);
    tpl.background = page.background;
    this.transact(() => { this.doc.templates.push(tpl); });
    return tpl;
  }
  applyTemplate(templateId: string): void {
    const tpl = this.doc.templates.find(t => t.id === templateId);
    const page = this.currentPage;
    if (!tpl || !page) return;
    this.transact(() => {
      page.templateId = tpl.id;
      page.background = tpl.background;
      page.elements = tpl.elements.map(e => ({ ...e, id: `${e.type.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}` }));
    });
  }
  deleteTemplate(id: string): void {
    this.transact(() => {
      this.doc.templates = this.doc.templates.filter(t => t.id !== id);
      this.doc.pages.forEach(p => { if (p.templateId === id) p.templateId = undefined; });
    });
  }

  // Element operations
  addElement(el: AnyElement): void {
    const page = this.currentPage;
    if (!page) return;
    this.transact(() => { page.elements.push(el); });
    this.selectedIds = new Set([el.id]);
    this.emit();
  }
  removeSelected(): void {
    const page = this.currentPage;
    if (!page) return;
    if (!this.selectedIds.size) return;
    this.transact(() => {
      page.elements = page.elements.filter(e => !this.selectedIds.has(e.id));
    });
    this.selectedIds.clear();
    this.emit();
  }
  updateElement(id: string, patch: Partial<AnyElement>): void {
    const page = this.currentPage;
    if (!page) return;
    const el = page.elements.find(e => e.id === id);
    if (!el) return;
    Object.assign(el, patch);
    this.emit();
  }
  reorder(id: string, delta: number): void {
    const page = this.currentPage;
    if (!page) return;
    const idx = page.elements.findIndex(e => e.id === id);
    if (idx < 0) return;
    const target = Math.max(0, Math.min(page.elements.length - 1, idx + delta));
    if (target === idx) return;
    this.transact(() => {
      const [el] = page.elements.splice(idx, 1);
      page.elements.splice(target, 0, el);
    });
  }

  setSelection(ids: string[] | string | null): void {
    if (ids == null) this.selectedIds = new Set();
    else if (typeof ids === 'string') this.selectedIds = new Set([ids]);
    else this.selectedIds = new Set(ids);
    this.emit();
  }

  selected(): AnyElement[] {
    const page = this.currentPage;
    if (!page) return [];
    return page.elements.filter(e => this.selectedIds.has(e.id));
  }

  setDocumentMeta(patch: Partial<PrintDocument>): void {
    this.transact(() => { Object.assign(this.doc, patch); });
  }

  resetDocument(): void {
    this.transact(() => {
      const fresh = newDocument(this.doc.size);
      this.doc.pages = fresh.pages;
      this.doc.templates = [];
      this.currentPageId = this.doc.pages[0].id;
      this.selectedIds.clear();
    });
  }
}

export const store = new Store();
