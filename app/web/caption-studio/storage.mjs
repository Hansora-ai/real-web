const requestPromise = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function database() {
  const req = indexedDB.open("hansora-caption-studio", 2);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts");
    if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects");
  };
  return requestPromise(req);
}
// Only the five most recently edited projects are stored on the device; older ones are deleted.
export const MAX_PROJECTS = 5;
async function withStore(mode, fn) {
  const db = await database();
  try {
    const tx = db.transaction("projects", mode), store = tx.objectStore("projects");
    const done = new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); tx.onabort = () => j(tx.error); });
    const result = await fn(store);
    await done;
    return result;
  } finally {
    db.close();
  }
}
export async function saveProject(project, assets, thumb = "") {
  const record = {
    id: project.id,
    name: project.name,
    updatedAt: Date.now(),
    thumb,
    project,
    assets: [...assets.values()].map(({ url, image, ...a }) => a),
  };
  return withStore("readwrite", async (store) => {
    store.put(record, project.id);
    const all = await requestPromise(store.getAll());
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of all.slice(MAX_PROJECTS)) store.delete(old.id);
  });
}
export async function listProjects() {
  const all = await withStore("readonly", (store) => requestPromise(store.getAll()));
  return all
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PROJECTS)
    .map(({ id, name, updatedAt, thumb }) => ({ id, name, updatedAt, thumb }));
}
export async function loadProject(id) {
  return withStore("readonly", (store) => requestPromise(store.get(id)));
}
export async function deleteProject(id) {
  return withStore("readwrite", (store) => { store.delete(id); });
}
// One-time move of the old single draft into the projects list.
export async function migrateDraft() {
  const draft = await readDraft().catch(() => null);
  if (!draft?.project) return;
  const project = { ...draft.project, id: draft.project.id || globalThis.crypto.randomUUID() };
  if (project.clips?.length || draft.assets?.length)
    await withStore("readwrite", (store) => { store.put({ id: project.id, name: project.name, updatedAt: Date.now() - 1, thumb: "", project, assets: draft.assets || [] }, project.id); });
  const db = await database();
  try {
    const tx = db.transaction("drafts", "readwrite");
    tx.objectStore("drafts").delete("current");
    await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; });
  } finally { db.close(); }
}
export async function saveDraft(project, assets) {
  const db = await database();
  try {
    const tx = db.transaction("drafts", "readwrite");
    const done = new Promise((r, j) => {
      tx.oncomplete = r;
      tx.onerror = () => j(tx.error);
      tx.onabort = () => j(tx.error);
    });
    tx.objectStore("drafts").put(
      {
        project,
        assets: [...assets.values()].map(({ url, image, ...a }) => a),
      },
      "current",
    );
    await done;
  } finally {
    db.close();
  }
}
export async function readDraft() {
  const db = await database();
  try {
    return await requestPromise(
      db.transaction("drafts").objectStore("drafts").get("current"),
    );
  } finally {
    db.close();
  }
}
function asBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
export async function projectFile(project, assets) {
  const data = [];
  for (const { url, image, file, ...a } of assets.values())
    data.push({
      ...a,
      name: file.name,
      type: file.type,
      bytes: await asBase64(file),
    });
  return new Blob(
    [
      JSON.stringify({
        format: "hansora-caption-studio",
        project,
        assets: data,
      }),
    ],
    { type: "application/json" },
  );
}
export function unpackProject(raw) {
  if (
    raw?.format !== "hansora-caption-studio" ||
    !Array.isArray(raw.assets) ||
    raw.assets.length > 150
  )
    throw Error("This is not a Caption Studio project.");
  const assets = raw.assets.map((a) => {
    if (
      !["video", "audio", "image", "font"].includes(a.kind) ||
      typeof a.bytes !== "string"
    )
      throw Error("Invalid project media.");
    const bytes = Uint8Array.from(atob(a.bytes), (c) => c.charCodeAt(0));
    const { bytes: encoded, name, type, ...metadata } = a;
    return {
      ...metadata,
      file: new File([bytes], String(name || "media"), { type }),
    };
  });
  if (assets.reduce((sum, a) => sum + a.file.size, 0) > 200 * 1048576)
    throw Error("The project exceeds the 200 MB media limit.");
  return { project: raw.project, assets };
}
