export const escapeHtml = (dangerousHtml: string) =>
  dangerousHtml.replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
