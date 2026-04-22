import type { PrintDocument, AnyElement } from '../types';
import { rasterizeElement, rasterizeImage, loadImage, getCachedImage } from './rasterize';

const VERT = `#version 300 es
in vec2 a_pos;     // unit quad 0..1
in vec2 a_uv;
uniform mat3 u_world; // element local -> page-mm space (x,y,size,rot)
uniform mat3 u_view;  // page-mm -> clip
uniform float u_aspectFlipY;
out vec2 v_uv;
void main() {
  vec3 p = u_view * u_world * vec3(a_pos, 1.0);
  gl_Position = vec4(p.x, p.y * u_aspectFlipY, 0.0, 1.0);
  v_uv = a_uv;
}`;

const FRAG_TEX = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv);
  outColor = vec4(c.rgb, c.a * u_opacity);
}`;

const FRAG_SOLID = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`;

interface ElementCache {
  tex: WebGLTexture;
  texW: number;
  texH: number;
  signature: string; // hash of the inputs that affect rasterization
  pxPerMm: number;
}

export interface ViewState {
  zoom: number; // px per mm on screen
  panX: number; // mm offset of view origin
  panY: number; // mm offset of view origin
}

export class Renderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  private progTex: WebGLProgram;
  private progSolid: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private cache = new Map<string, ElementCache>();
  view: ViewState = { zoom: 2, panX: 0, panY: 0 };
  doc!: PrintDocument;
  pageId!: string;
  selectedIds: Set<string> = new Set();
  showGrid = false;
  gridSize = 10;
  showRulers = true;
  showMargins = true;
  showBleed = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.progTex = createProgram(gl, VERT, FRAG_TEX);
    this.progSolid = createProgram(gl, VERT, FRAG_SOLID);
    this.quad = this.createQuad();
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private createQuad(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // pos.xy, uv.xy
    const verts = new Float32Array([
      0, 0, 0, 0,
      1, 0, 1, 0,
      0, 1, 0, 1,
      1, 1, 1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    return vao;
  }

  setDocument(doc: PrintDocument, pageId: string, selected: Set<string>): void {
    this.doc = doc;
    this.pageId = pageId;
    this.selectedIds = selected;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width * dpr));
    const h = Math.max(1, Math.floor(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  // Convert screen px coords (relative to canvas) to mm (page) coords.
  screenToMm(sx: number, sy: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const cx = sx - r.left;
    const cy = sy - r.top;
    return { x: cx / this.view.zoom + this.view.panX, y: cy / this.view.zoom + this.view.panY };
  }
  mmToScreen(mx: number, my: number): { x: number; y: number } {
    return { x: (mx - this.view.panX) * this.view.zoom, y: (my - this.view.panY) * this.view.zoom };
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToMm(sx, sy);
    this.view.zoom = Math.max(0.2, Math.min(40, this.view.zoom * factor));
    const after = this.screenToMm(sx, sy);
    this.view.panX += before.x - after.x;
    this.view.panY += before.y - after.y;
  }

  fitToScreen(padding = 40): void {
    const r = this.canvas.getBoundingClientRect();
    const bleedW = this.doc.size.width + this.doc.bleed.left + this.doc.bleed.right;
    const bleedH = this.doc.size.height + this.doc.bleed.top + this.doc.bleed.bottom;
    const zx = (r.width - padding * 2) / bleedW;
    const zy = (r.height - padding * 2) / bleedH;
    this.view.zoom = Math.max(0.2, Math.min(zx, zy));
    this.view.panX = -this.doc.bleed.left - (r.width / this.view.zoom - bleedW) / 2;
    this.view.panY = -this.doc.bleed.top - (r.height / this.view.zoom - bleedH) / 2;
  }

  private viewMatrix(): Float32Array {
    // page-mm -> clip space (-1..1). canvas pixels = (mm - pan) * zoom.
    const r = this.canvas.getBoundingClientRect();
    const sx = (2 * this.view.zoom) / r.width;
    const sy = (2 * this.view.zoom) / r.height;
    const tx = -1 - this.view.panX * sx;
    const ty = -1 - this.view.panY * sy;
    // column-major mat3
    return new Float32Array([
      sx, 0, 0,
      0, sy, 0,
      tx, ty, 1,
    ]);
  }

  private worldMatrix(x: number, y: number, w: number, h: number, rotDeg: number): Float32Array {
    const rad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // Local quad 0..1 -> scale w/h, rotate around center (w/2, h/2), translate to (x,y).
    // M = T(x,y) * T(cw,ch) * R * T(-cw,-ch) * S(w,h)
    const cw = w / 2, ch = h / 2;
    // Compose:
    // After scale: (X*w, Y*h, 1)
    // After T(-cw,-ch): (X*w - cw, Y*h - ch)
    // After R: (a*xs - b*ys, b*xs + a*ys) where a=cos,b=sin
    // After T(cw,ch): + (cw, ch)
    // After T(x,y): + (x,y)
    const a = cos, b = sin;
    // m11 = a*w, m12 = -b*w  (column-major: column 0 = (m11, m21, m31))
    const m11 = a * w;
    const m21 = b * w;
    const m12 = -b * h;
    const m22 = a * h;
    const m13 = -a * cw + b * ch + cw + x;
    const m23 = -b * cw - a * ch + ch + y;
    return new Float32Array([
      m11, m21, 0,
      m12, m22, 0,
      m13, m23, 1,
    ]);
  }

  render(): void {
    if (!this.doc) return;
    this.resize();
    const gl = this.gl;
    gl.clearColor(0.13, 0.13, 0.14, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const page = this.doc.pages.find(p => p.id === this.pageId);
    if (!page) return;

    const view = this.viewMatrix();
    const flipY = -1; // canvas y is down, clip y is up

    // 1) Bleed area
    if (this.showBleed) {
      const bleed = this.doc.bleed;
      this.drawSolid(view, flipY,
        -bleed.left, -bleed.top,
        this.doc.size.width + bleed.left + bleed.right,
        this.doc.size.height + bleed.top + bleed.bottom,
        [0.96, 0.86, 0.86, 1]);
    }

    // 2) Page background
    this.drawSolid(view, flipY, 0, 0, this.doc.size.width, this.doc.size.height, hexToRgba(page.background, 1));

    // 3) Grid
    if (this.showGrid && this.gridSize > 0) {
      const c: [number, number, number, number] = [0.85, 0.85, 0.9, 1];
      for (let x = 0; x <= this.doc.size.width + 0.001; x += this.gridSize) {
        this.drawSolid(view, flipY, x - 0.05, 0, 0.1, this.doc.size.height, c);
      }
      for (let y = 0; y <= this.doc.size.height + 0.001; y += this.gridSize) {
        this.drawSolid(view, flipY, 0, y - 0.05, this.doc.size.width, 0.1, c);
      }
    }

    // 4) Elements
    const pxPerMm = this.view.zoom * (window.devicePixelRatio || 1);
    for (const el of page.elements) {
      if (el.hidden) continue;
      this.drawElement(el, view, flipY, pxPerMm);
    }

    // 5) Margins (drawn over content)
    if (this.showMargins) {
      const m = this.doc.margins;
      const c: [number, number, number, number] = [0.32, 0.7, 1.0, 1];
      const t = 0.15;
      const w = this.doc.size.width, h = this.doc.size.height;
      this.drawSolid(view, flipY, m.left, m.top, w - m.left - m.right, t, c); // top
      this.drawSolid(view, flipY, m.left, h - m.bottom - t, w - m.left - m.right, t, c); // bottom
      this.drawSolid(view, flipY, m.left, m.top, t, h - m.top - m.bottom, c); // left
      this.drawSolid(view, flipY, w - m.right - t, m.top, t, h - m.top - m.bottom, c); // right
    }

    // 6) Selection outlines
    for (const id of this.selectedIds) {
      const el = page.elements.find(e => e.id === id);
      if (!el) continue;
      this.drawSelection(el, view, flipY);
    }
  }

  private drawElement(el: AnyElement, view: Float32Array, flipY: number, pxPerMm: number): void {
    const sig = signature(el);
    let cached = this.cache.get(el.id);
    const renderScale = clampScale(pxPerMm);
    const needsRebuild = !cached || cached.signature !== sig || Math.abs(cached.pxPerMm - renderScale) / renderScale > 0.25;
    if (needsRebuild) {
      let canvas: HTMLCanvasElement | null = null;
      if (el.type === 'image') {
        const img = getCachedImage(el.src);
        if (img) {
          canvas = rasterizeImage(el, img, renderScale);
        } else {
          loadImage(el.src).then(() => this.invalidate(el.id)).catch(() => {});
        }
      } else {
        canvas = rasterizeElement(el, renderScale);
      }
      if (canvas) {
        if (cached) this.gl.deleteTexture(cached.tex);
        const tex = uploadTexture(this.gl, canvas);
        cached = { tex, texW: canvas.width, texH: canvas.height, signature: sig, pxPerMm: renderScale };
        this.cache.set(el.id, cached);
      }
    }
    if (!cached) return;
    const world = this.worldMatrix(el.x, el.y, el.width, el.height, el.rotation);
    this.drawTextured(view, flipY, world, cached.tex, el.opacity);
  }

  private drawSelection(el: AnyElement, view: Float32Array, flipY: number): void {
    const c: [number, number, number, number] = [0.16, 0.55, 1.0, 1];
    const t = Math.max(0.1, 1.5 / this.view.zoom);
    const w = el.width, h = el.height;
    // Note: rotation isn't applied to selection here for clarity (simpler hit-handles).
    const world1 = this.worldMatrix(el.x, el.y, w, t, el.rotation);
    const world2 = this.worldMatrix(el.x, el.y + h - t, w, t, el.rotation);
    const world3 = this.worldMatrix(el.x, el.y, t, h, el.rotation);
    const world4 = this.worldMatrix(el.x + w - t, el.y, t, h, el.rotation);
    this.drawSolidMat(view, flipY, world1, c);
    this.drawSolidMat(view, flipY, world2, c);
    this.drawSolidMat(view, flipY, world3, c);
    this.drawSolidMat(view, flipY, world4, c);
    // Corner handles
    const hs = Math.max(1, 6 / this.view.zoom);
    const handles = [
      [el.x - hs / 2, el.y - hs / 2],
      [el.x + w - hs / 2, el.y - hs / 2],
      [el.x - hs / 2, el.y + h - hs / 2],
      [el.x + w - hs / 2, el.y + h - hs / 2],
    ];
    for (const [hx, hy] of handles) {
      this.drawSolid(view, flipY, hx, hy, hs, hs, [1, 1, 1, 1]);
      this.drawSolid(view, flipY, hx + 0.5 / this.view.zoom, hy + 0.5 / this.view.zoom,
        hs - 1 / this.view.zoom, hs - 1 / this.view.zoom, c);
    }
  }

  private drawSolid(view: Float32Array, flipY: number, x: number, y: number, w: number, h: number, color: [number, number, number, number]): void {
    const world = this.worldMatrix(x, y, w, h, 0);
    this.drawSolidMat(view, flipY, world, color);
  }
  private drawSolidMat(view: Float32Array, flipY: number, world: Float32Array, color: [number, number, number, number]): void {
    const gl = this.gl;
    gl.useProgram(this.progSolid);
    gl.bindVertexArray(this.quad);
    setMat3(gl, this.progSolid, 'u_world', world);
    setMat3(gl, this.progSolid, 'u_view', view);
    gl.uniform1f(gl.getUniformLocation(this.progSolid, 'u_aspectFlipY'), flipY);
    gl.uniform4f(gl.getUniformLocation(this.progSolid, 'u_color'), color[0], color[1], color[2], color[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
  private drawTextured(view: Float32Array, flipY: number, world: Float32Array, tex: WebGLTexture, opacity: number): void {
    const gl = this.gl;
    gl.useProgram(this.progTex);
    gl.bindVertexArray(this.quad);
    setMat3(gl, this.progTex, 'u_world', world);
    setMat3(gl, this.progTex, 'u_view', view);
    gl.uniform1f(gl.getUniformLocation(this.progTex, 'u_aspectFlipY'), flipY);
    gl.uniform1f(gl.getUniformLocation(this.progTex, 'u_opacity'), opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(this.progTex, 'u_tex'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  invalidate(id?: string): void {
    if (id) {
      const c = this.cache.get(id);
      if (c) { this.gl.deleteTexture(c.tex); this.cache.delete(id); }
    } else {
      for (const c of this.cache.values()) this.gl.deleteTexture(c.tex);
      this.cache.clear();
    }
  }
}

function clampScale(s: number): number {
  // Quantize for cache stability and to avoid huge textures at extreme zoom.
  const max = 12; // px/mm max for screen
  return Math.min(max, Math.max(1, s));
}

function signature(el: AnyElement): string {
  // Include all properties that affect rasterization.
  const base = `${el.type}|${el.width.toFixed(3)}x${el.height.toFixed(3)}`;
  if (el.type === 'text') {
    return `${base}|${el.text}|${el.fontFamily}|${el.fontSize}|${el.fontWeight}|${el.italic}|${el.color}|${el.lineHeight}|${el.letterSpacing}|${el.align}|${el.vAlign}`;
  }
  if (el.type === 'rect') {
    return `${base}|${el.fill}|${el.stroke}|${el.strokeWidth}|${el.cornerRadius}`;
  }
  if (el.type === 'image') {
    return `${base}|${el.src.length}|${el.fit}`;
  }
  return base;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile error: ' + log);
  }
  return sh;
}
function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.bindAttribLocation(p, 1, 'a_uv');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
  }
  return p;
}
function setMat3(gl: WebGL2RenderingContext, p: WebGLProgram, name: string, m: Float32Array): void {
  gl.uniformMatrix3fv(gl.getUniformLocation(p, name), false, m);
}
function uploadTexture(gl: WebGL2RenderingContext, src: HTMLCanvasElement): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : alpha;
  return [r, g, b, a];
}
