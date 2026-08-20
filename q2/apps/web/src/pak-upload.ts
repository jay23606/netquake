/**
 * File: pak-upload.ts
 * Purpose: Let a player add their own Quake II data, the way the Quake 1 client
 * accepts pak1.pak.
 *
 * The site ships only the freely distributable demo pak. Retail data belongs to
 * whoever bought the game: it is read in the browser, kept in IndexedDB, and
 * never sent anywhere.
 */

import { inspectPak, listUploadedPaks, saveUploadedPak, clearUploadedPaks } from "./pak-storage.js";

const readFile = (file: File): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.readAsArrayBuffer(file);
  });

export async function installPakUpload(): Promise<void> {
  const host = document.createElement("div");
  host.className = "pak-upload";

  const status = document.createElement("span");
  const button = document.createElement("button");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pak";
  input.style.display = "none";

  const refresh = async (): Promise<void> => {
    const stored = await listUploadedPaks();
    if (stored.size === 0) {
      status.textContent = "";
      button.textContent = "Add Quake II data";
      button.title = "Own Quake II? Add its pak files to unlock the full game.";
      return;
    }
    const entries = [...stored.values()]
      .map((bytes) => inspectPak(bytes)?.entries ?? 0)
      .reduce((a, b) => a + b, 0);
    status.textContent = `${stored.size} pak (${entries} files) `;
    button.textContent = "remove";
    button.title = "Remove your added Quake II data and go back to the demo.";
  };

  button.addEventListener("click", async () => {
    const stored = await listUploadedPaks();
    if (stored.size > 0) {
      await clearUploadedPaks();
      window.location.reload();
      return;
    }
    input.click();
  });

  input.addEventListener("change", () => {
    void (async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const bytes = await readFile(file);
        const summary = inspectPak(bytes);
        if (!summary) {
          status.textContent = "not a pak file ";
          return;
        }
        // pak0 is the demo data this site ships; a player's own files are
        // mounted after it so they take precedence.
        const name = file.name.toLowerCase() === "pak0.pak" ? "pak1.pak" : file.name.toLowerCase();
        await saveUploadedPak(name, bytes);
        window.location.reload();
      } catch (error) {
        status.textContent = error instanceof Error ? `${error.message} ` : "upload failed ";
      }
    })();
  });

  host.append(status, button, input);
  document.body.append(host);
  await refresh();
}
