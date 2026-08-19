export const OfficialSource = 'official'
export type Source = 'quaddicted' | 'slipseer' | 'custom' | typeof OfficialSource
export type SourceId = `${Source}:${string}`;

export const retailSourceId = `official:original`;