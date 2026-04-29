import type {
  PrintDocument,
  Page,
  AnyElement,
  Template,
  TextElement,
  ImageElement,
  RectElement,
  PageSize,
} from "./types";
import { A_SIZES } from "./types";

const LEGACY_DOC_KEY = "print.document.v1";
const PREFS_KEY = "print.prefs.v1";
const PROJECTS_INDEX_KEY = "print.projects.index.v1";
const PROJECT_PREFIX = "print.project.";

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
}

interface ProjectsIndex {
  currentId: string;
  projects: ProjectMeta[];
}

function projectKey(id: string): string {
  return `${PROJECT_PREFIX}${id}.v1`;
}

// Detect localStorage quota exhaustion across browsers. Chrome throws a
// DOMException named "QuotaExceededError" (code 22), Firefox uses
// "NS_ERROR_DOM_QUOTA_REACHED" (code 1014), Safari may throw a generic
// QUOTA_EXCEEDED_ERR.
function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false;
  return (
    e.code === 22 ||
    e.code === 1014 ||
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED"
  );
}

export interface Prefs {
  unit: "mm" | "cm" | "in" | "pt";
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
  unit: "cm",
  showRulers: true,
  showGuides: true,
  showMargins: true,
  showBleed: true,
  snapEnabled: true,
  snapTolerance: 8,
  gridSize: 10,
  showGrid: false,
};

function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newTextElement(
  partial: Partial<TextElement> = {},
): TextElement {
  return {
    id: uid("txt"),
    type: "text",
    x: 20,
    y: 20,
    width: 80,
    height: 20,
    rotation: 0,
    opacity: 1,
    text: "New text",
    fontFamily: "Helvetica, Arial, sans-serif",
    fontSize: 18,
    fontWeight: 400,
    italic: false,
    color: "#111111",
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left",
    vAlign: "top",
    ...partial,
  };
}

export function newRectElement(
  partial: Partial<RectElement> = {},
): RectElement {
  return {
    id: uid("rct"),
    type: "rect",
    x: 20,
    y: 20,
    width: 60,
    height: 40,
    rotation: 0,
    opacity: 1,
    fill: "#3a86ff",
    stroke: "#000000",
    strokeWidth: 0,
    cornerRadius: 0,
    ...partial,
  };
}

export function newImageElement(
  partial: Partial<ImageElement> & Pick<ImageElement, "src">,
): ImageElement {
  return {
    id: uid("img"),
    type: "image",
    x: 20,
    y: 20,
    width: 80,
    height: 60,
    rotation: 0,
    opacity: 1,
    fit: "contain",
    ...partial,
  };
}

export function newPage(name = `Page`): Page {
  return {
    id: uid("pg"),
    name,
    elements: [],
    background: "#ffffff",
  };
}

export function newTemplate(
  name = "Template",
  elements: AnyElement[] = [],
): Template {
  return {
    id: uid("tpl"),
    name,
    elements: elements.map((e) => ({ ...e, id: uid(e.type.slice(0, 3)) })),
    background: "#ffffff",
  };
}

export function newDocument(size: PageSize = A_SIZES.A4): PrintDocument {
  const now = Date.now();
  const page = newPage("Page 1");
  return {
    id: uid("doc"),
    name: "Untitled Document",
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
  private projectsIndex: ProjectsIndex;

  constructor() {
    this.prefs = this.loadPrefs();
    this.projectsIndex = this.loadProjectsIndex();
    this.doc = this.loadCurrentDoc();
    this.currentPageId = this.doc.pages[0].id;
  }

  private loadProjectsIndex(): ProjectsIndex {
    try {
      const raw = localStorage.getItem(PROJECTS_INDEX_KEY);
      if (raw) {
        const idx = JSON.parse(raw) as ProjectsIndex;
        if (idx && Array.isArray(idx.projects) && idx.projects.length) {
          return idx;
        }
      }
    } catch {
      /* ignore */
    }
    // Migrate from legacy single-doc storage if present.
    try {
      const legacy = localStorage.getItem(LEGACY_DOC_KEY);
      if (legacy) {
        const doc = JSON.parse(legacy) as PrintDocument;
        if (doc && doc.id) {
          localStorage.setItem(projectKey(doc.id), legacy);
          const idx: ProjectsIndex = {
            currentId: doc.id,
            projects: [
              {
                id: doc.id,
                name: doc.name || "Untitled Document",
                updatedAt: doc.updatedAt || Date.now(),
              },
            ],
          };
          localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(idx));
          // Keep the legacy key around for one cycle in case of rollback;
          // it will be ignored on subsequent loads.
          return idx;
        }
      }
    } catch {
      /* ignore */
    }
    // No projects yet — create a fresh one.
    const fresh = newDocument();
    localStorage.setItem(projectKey(fresh.id), JSON.stringify(fresh));
    const idx: ProjectsIndex = {
      currentId: fresh.id,
      projects: [
        { id: fresh.id, name: fresh.name, updatedAt: fresh.updatedAt },
      ],
    };
    localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(idx));
    return idx;
  }

  private loadCurrentDoc(): PrintDocument {
    const id = this.projectsIndex.currentId;
    try {
      const raw = localStorage.getItem(projectKey(id));
      if (raw) return JSON.parse(raw) as PrintDocument;
    } catch {
      /* ignore */
    }
    // Project record missing — fall back to creating a fresh doc with same id.
    const fresh = newDocument();
    fresh.id = id;
    localStorage.setItem(projectKey(id), JSON.stringify(fresh));
    return fresh;
  }

  private persistIndex(): void {
    localStorage.setItem(
      PROJECTS_INDEX_KEY,
      JSON.stringify(this.projectsIndex),
    );
  }

  private loadPrefs(): Prefs {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) return { ...defaultPrefs, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return { ...defaultPrefs };
  }

  save(): void {
    this.doc.updatedAt = Date.now();
    const key = projectKey(this.doc.id);
    const payload = JSON.stringify(this.doc);
    try {
      localStorage.setItem(key, payload);
    } catch (e) {
      if (isQuotaError(e)) {
        // Free space by dropping undo/redo snapshots (each can be as large
        // as the document itself) and try again.
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        try {
          localStorage.setItem(key, payload);
        } catch (e2) {
          if (isQuotaError(e2)) {
            const err = new Error(
              "Local storage is full. Remove some images, large content, or " +
                "delete other projects before adding more.",
            ) as Error & { code: "QUOTA_EXCEEDED" };
            err.code = "QUOTA_EXCEEDED";
            throw err;
          }
          throw e2;
        }
      } else {
        throw e;
      }
    }
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* prefs are non-critical */
    }
    // Sync index metadata for this project.
    const meta = this.projectsIndex.projects.find((p) => p.id === this.doc.id);
    if (meta) {
      let dirty = false;
      if (meta.name !== this.doc.name) {
        meta.name = this.doc.name;
        dirty = true;
      }
      if (meta.updatedAt !== this.doc.updatedAt) {
        meta.updatedAt = this.doc.updatedAt;
        dirty = true;
      }
      if (this.projectsIndex.currentId !== this.doc.id) {
        this.projectsIndex.currentId = this.doc.id;
        dirty = true;
      }
      if (dirty) this.persistIndex();
    } else {
      this.projectsIndex.projects.push({
        id: this.doc.id,
        name: this.doc.name,
        updatedAt: this.doc.updatedAt,
      });
      this.projectsIndex.currentId = this.doc.id;
      this.persistIndex();
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  emit(): void {
    this.save();
    this.listeners.forEach((l) => l());
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
    try {
      fn();
    } finally {
      this.suspendHistory = false;
    }
    this.emit();
  }

  ensureCurrentPage(): void {
    if (!this.doc.pages.find((p) => p.id === this.currentPageId)) {
      this.currentPageId = this.doc.pages[0]?.id ?? "";
    }
  }

  // Page operations
  get currentPage(): Page | undefined {
    return this.doc.pages.find((p) => p.id === this.currentPageId);
  }
  setCurrentPage(id: string): void {
    this.currentPageId = id;
    this.selectedIds.clear();
    this.emit();
  }
  addPage(templateId?: string): Page {
    const tpl = templateId
      ? this.doc.templates.find((t) => t.id === templateId)
      : undefined;
    const page = newPage(`Page ${this.doc.pages.length + 1}`);
    if (tpl) {
      page.templateId = tpl.id;
      page.background = tpl.background;
      page.elements = tpl.elements.map((e) => ({
        ...e,
        id: `${e.type.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}`,
      }));
    }
    this.transact(() => {
      this.doc.pages.push(page);
    });
    this.currentPageId = page.id;
    this.emit();
    return page;
  }
  deletePage(id: string): void {
    if (this.doc.pages.length <= 1) return;
    this.transact(() => {
      this.doc.pages = this.doc.pages.filter((p) => p.id !== id);
    });
    this.ensureCurrentPage();
    this.emit();
  }
  movePage(id: string, delta: number): void {
    const idx = this.doc.pages.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const target = Math.max(
      0,
      Math.min(this.doc.pages.length - 1, idx + delta),
    );
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
    this.transact(() => {
      this.doc.templates.push(tpl);
    });
    return tpl;
  }
  applyTemplate(templateId: string): void {
    const tpl = this.doc.templates.find((t) => t.id === templateId);
    const page = this.currentPage;
    if (!tpl || !page) return;
    this.transact(() => {
      page.templateId = tpl.id;
      page.background = tpl.background;
      page.elements = tpl.elements.map((e) => ({
        ...e,
        id: `${e.type.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}`,
      }));
    });
  }
  deleteTemplate(id: string): void {
    this.transact(() => {
      this.doc.templates = this.doc.templates.filter((t) => t.id !== id);
      this.doc.pages.forEach((p) => {
        if (p.templateId === id) p.templateId = undefined;
      });
    });
  }

  // Element operations
  addElement(el: AnyElement): void {
    const page = this.currentPage;
    if (!page) return;
    try {
      this.transact(() => {
        page.elements.push(el);
      });
    } catch (e) {
      // Rollback the in-memory mutation if persisting failed (e.g. quota).
      const idx = page.elements.findIndex((x) => x.id === el.id);
      if (idx >= 0) page.elements.splice(idx, 1);
      this.emit();
      throw e;
    }
    this.selectedIds = new Set([el.id]);
    this.emit();
  }
  removeSelected(): void {
    const page = this.currentPage;
    if (!page) return;
    if (!this.selectedIds.size) return;
    this.transact(() => {
      page.elements = page.elements.filter((e) => !this.selectedIds.has(e.id));
    });
    this.selectedIds.clear();
    this.emit();
  }
  updateElement(id: string, patch: Partial<AnyElement>): void {
    const page = this.currentPage;
    if (!page) return;
    const el = page.elements.find((e) => e.id === id);
    if (!el) return;
    Object.assign(el, patch);
    this.emit();
  }
  reorder(id: string, delta: number): void {
    const page = this.currentPage;
    if (!page) return;
    const idx = page.elements.findIndex((e) => e.id === id);
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
    else if (typeof ids === "string") this.selectedIds = new Set([ids]);
    else this.selectedIds = new Set(ids);
    this.emit();
  }

  selected(): AnyElement[] {
    const page = this.currentPage;
    if (!page) return [];
    return page.elements.filter((e) => this.selectedIds.has(e.id));
  }

  setDocumentMeta(patch: Partial<PrintDocument>): void {
    this.transact(() => {
      Object.assign(this.doc, patch);
    });
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

  loadDocument(doc: PrintDocument): void {
    // Imports/loads replace the contents of the *current* project so the
    // project list stays predictable. Preserve the current project id and
    // creation time; bump updatedAt.
    const currentId = this.doc.id;
    const createdAt = this.doc.createdAt;
    this.transact(() => {
      this.doc = { ...doc, id: currentId, createdAt, updatedAt: Date.now() };
      this.currentPageId = this.doc.pages[0]?.id ?? "";
      this.selectedIds.clear();
    });
  }

  // --- Project management ---------------------------------------------------

  listProjects(): ProjectMeta[] {
    return [...this.projectsIndex.projects].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  get currentProjectId(): string {
    return this.doc.id;
  }

  createProject(name = "Untitled Document"): ProjectMeta {
    const doc = newDocument(this.doc.size);
    doc.name = name;
    localStorage.setItem(projectKey(doc.id), JSON.stringify(doc));
    const meta: ProjectMeta = {
      id: doc.id,
      name: doc.name,
      updatedAt: doc.updatedAt,
    };
    this.projectsIndex.projects.push(meta);
    this.projectsIndex.currentId = doc.id;
    this.persistIndex();
    // Switch to the new project (resets history).
    this.doc = doc;
    this.currentPageId = doc.pages[0].id;
    this.selectedIds.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
    return meta;
  }

  switchProject(id: string): void {
    if (id === this.doc.id) return;
    const meta = this.projectsIndex.projects.find((p) => p.id === id);
    if (!meta) return;
    // Persist current first so nothing is lost.
    this.save();
    let next: PrintDocument | null = null;
    try {
      const raw = localStorage.getItem(projectKey(id));
      if (raw) next = JSON.parse(raw) as PrintDocument;
    } catch {
      /* ignore */
    }
    if (!next) {
      // Project entry without storage — recreate empty doc with same id/name.
      next = newDocument();
      next.id = id;
      next.name = meta.name;
      localStorage.setItem(projectKey(id), JSON.stringify(next));
    }
    this.doc = next;
    this.currentPageId = this.doc.pages[0]?.id ?? "";
    this.selectedIds.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.projectsIndex.currentId = id;
    this.persistIndex();
    this.emit();
  }

  renameProject(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const meta = this.projectsIndex.projects.find((p) => p.id === id);
    if (!meta) return;
    meta.name = trimmed;
    this.persistIndex();
    if (id === this.doc.id) {
      // Update via transact so it goes through history & save pipeline.
      this.transact(() => {
        this.doc.name = trimmed;
      });
    } else {
      try {
        const raw = localStorage.getItem(projectKey(id));
        if (raw) {
          const d = JSON.parse(raw) as PrintDocument;
          d.name = trimmed;
          localStorage.setItem(projectKey(id), JSON.stringify(d));
        }
      } catch {
        /* ignore */
      }
      this.emit();
    }
  }

  deleteProject(id: string): void {
    const idx = this.projectsIndex.projects.findIndex((p) => p.id === id);
    if (idx < 0) return;
    this.projectsIndex.projects.splice(idx, 1);
    try {
      localStorage.removeItem(projectKey(id));
    } catch {
      /* ignore */
    }
    if (this.projectsIndex.projects.length === 0) {
      // Always keep at least one project around.
      const fresh = newDocument();
      localStorage.setItem(projectKey(fresh.id), JSON.stringify(fresh));
      this.projectsIndex.projects.push({
        id: fresh.id,
        name: fresh.name,
        updatedAt: fresh.updatedAt,
      });
      this.projectsIndex.currentId = fresh.id;
      this.persistIndex();
      this.doc = fresh;
      this.currentPageId = fresh.pages[0].id;
      this.selectedIds.clear();
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this.emit();
      return;
    }
    if (id === this.doc.id) {
      // Switch to the most recently updated remaining project.
      const next = [...this.projectsIndex.projects].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      )[0];
      let nextDoc: PrintDocument | null = null;
      try {
        const raw = localStorage.getItem(projectKey(next.id));
        if (raw) nextDoc = JSON.parse(raw) as PrintDocument;
      } catch {
        /* ignore */
      }
      if (!nextDoc) {
        nextDoc = newDocument();
        nextDoc.id = next.id;
        nextDoc.name = next.name;
        localStorage.setItem(projectKey(next.id), JSON.stringify(nextDoc));
      }
      this.doc = nextDoc;
      this.currentPageId = this.doc.pages[0]?.id ?? "";
      this.selectedIds.clear();
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this.projectsIndex.currentId = next.id;
      this.persistIndex();
      this.emit();
    } else {
      this.persistIndex();
      this.emit();
    }
  }

  duplicateProject(id: string): ProjectMeta | undefined {
    const meta = this.projectsIndex.projects.find((p) => p.id === id);
    if (!meta) return;
    let source: PrintDocument | null = null;
    if (id === this.doc.id) {
      source = JSON.parse(JSON.stringify(this.doc)) as PrintDocument;
    } else {
      try {
        const raw = localStorage.getItem(projectKey(id));
        if (raw) source = JSON.parse(raw) as PrintDocument;
      } catch {
        /* ignore */
      }
    }
    if (!source) return;
    const copy: PrintDocument = {
      ...source,
      id: `doc_${Math.random().toString(36).slice(2, 10)}`,
      name: `${source.name} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    localStorage.setItem(projectKey(copy.id), JSON.stringify(copy));
    const m: ProjectMeta = {
      id: copy.id,
      name: copy.name,
      updatedAt: copy.updatedAt,
    };
    this.projectsIndex.projects.push(m);
    this.persistIndex();
    this.emit();
    return m;
  }
}

export const store = new Store();
