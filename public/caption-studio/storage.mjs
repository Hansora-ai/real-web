const requestPromise = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function database() {
  const req = indexedDB.open("hansora-caption-studio", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("drafts");
  return requestPromise(req);
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
