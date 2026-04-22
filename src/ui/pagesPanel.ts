import { store } from "../store";
import type { Renderer } from "../webgl/renderer";

export function buildPagesPanel(
  host: HTMLElement,
  renderer: Renderer,
  requestRender: () => void,
): void {
  const render = (): void => {
    host.innerHTML = "";
    const header = document.createElement("div");
    header.className = "panel-header";
    header.innerHTML = "<h3>Pages</h3>";
    const add = document.createElement("button");
    add.className = "btn small";
    add.textContent = "+";
    add.title = "Add page";
    add.addEventListener("click", () => {
      const tplId = (tplSelect.value || undefined) as string | undefined;
      store.addPage(tplId);
      renderer.invalidate();
      requestRender();
    });
    header.appendChild(add);
    host.appendChild(header);

    // Template selector for new pages
    const tplSelect = document.createElement("select");
    tplSelect.className = "select wide";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— blank —";
    tplSelect.appendChild(opt0);
    for (const t of store.doc.templates) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      tplSelect.appendChild(o);
    }
    const tplLabel = document.createElement("label");
    tplLabel.className = "lc";
    const lt = document.createElement("span");
    lt.textContent = "New page from";
    tplLabel.appendChild(lt);
    tplLabel.appendChild(tplSelect);
    host.appendChild(tplLabel);

    const list = document.createElement("div");
    list.className = "page-list";
    store.doc.pages.forEach((p, i) => {
      const item = document.createElement("div");
      item.className = "page-item";
      if (p.id === store.currentPageId) item.classList.add("active");
      item.innerHTML = `<div class="thumb">${i + 1}</div>`;
      const meta = document.createElement("div");
      meta.className = "meta";
      const name = document.createElement("input");
      name.type = "text";
      name.value = p.name;
      name.addEventListener("change", () => {
        store.transact(() => {
          p.name = name.value;
        });
      });
      meta.appendChild(name);
      const tplName = store.doc.templates.find(
        (t) => t.id === p.templateId,
      )?.name;
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = tplName ? `template: ${tplName}` : "no template";
      meta.appendChild(sub);
      item.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "actions";
      actions.appendChild(
        iconBtn("▲", "Move up", () => {
          store.movePage(p.id, -1);
          requestRender();
        }),
      );
      actions.appendChild(
        iconBtn("▼", "Move down", () => {
          store.movePage(p.id, 1);
          requestRender();
        }),
      );
      actions.appendChild(
        iconBtn("×", "Delete", () => {
          if (store.doc.pages.length > 1 && confirm(`Delete ${p.name}?`)) {
            store.deletePage(p.id);
            renderer.invalidate();
            requestRender();
          }
        }),
      );
      item.appendChild(actions);
      item.addEventListener("click", (e) => {
        if (
          (e.target as HTMLElement).tagName === "INPUT" ||
          (e.target as HTMLElement).tagName === "BUTTON"
        )
          return;
        store.setCurrentPage(p.id);
        renderer.invalidate();
        requestRender();
      });
      list.appendChild(item);
    });
    host.appendChild(list);

    // Templates section
    const tplHeader = document.createElement("div");
    tplHeader.className = "panel-header";
    tplHeader.innerHTML = "<h3>Templates</h3>";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn small";
    saveBtn.textContent = "Save current";
    saveBtn.addEventListener("click", () => {
      const name = prompt(
        "Template name:",
        `Template ${store.doc.templates.length + 1}`,
      );
      if (!name) return;
      store.saveAsTemplate(name);
    });
    tplHeader.appendChild(saveBtn);
    host.appendChild(tplHeader);

    const tplList = document.createElement("div");
    tplList.className = "tpl-list";
    if (!store.doc.templates.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent =
        "No templates yet. Save the current page as a template to reuse its layout.";
      tplList.appendChild(empty);
    }
    for (const t of store.doc.templates) {
      const row = document.createElement("div");
      row.className = "tpl-item";
      const n = document.createElement("span");
      n.textContent = t.name;
      row.appendChild(n);
      row.appendChild(
        iconBtn(
          "Apply",
          "Apply to current page",
          () => {
            store.applyTemplate(t.id);
            renderer.invalidate();
            requestRender();
          },
          "small",
        ),
      );
      row.appendChild(
        iconBtn(
          "×",
          "Delete template",
          () => {
            if (confirm(`Delete template ${t.name}?`)) {
              store.deleteTemplate(t.id);
            }
          },
          "small",
        ),
      );
      tplList.appendChild(row);
    }
    host.appendChild(tplList);
  };
  store.subscribe(render);
  render();
}

function iconBtn(
  label: string,
  title: string,
  onClick: () => void,
  extra = "",
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn icon " + extra;
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
