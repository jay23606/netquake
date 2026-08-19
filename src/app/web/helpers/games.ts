import originalMaps from './maps/original'
import hipnotic from './maps/hipnotic'
import rogue from './maps/rogue'
import mg1 from './maps/mg1'
import mg3 from './maps/mg3'
import dimensionOfTheMachineArt from '../assets/campaign-dimension-of-the-machine.jpg'
import dawnOfTheMachineArt from '../assets/campaign-dawn-of-the-machine.jpg'
import { SourceId } from '../../../shared/types/Source'

export type MapName = string
export type GameDir = 'id1' | 'hipnotic' | 'rogue' | string

export type Mod = 'dm' | 'ctf'
export type MultiplayerMap = {
  name: MapName,
  title: string,
  played: 'regularly' | 'occasionally' | 'rarely'
  size: 'small' | 'medium' | 'large'
  mod: Mod
  author?: string
}

export type GameMap = {
  name: string,
  title: string,
  collection: string
  /** False for maps the pack does not offer in singleplayer (deathmatch, horde). Absent means playable. */
  sp?: boolean
}

export const officialGame = {
  Original: 'original',
  Hipnotic: 'hipnotic',
  Rogue: 'rogue',
  DimensionOfTheMachine: 'mg1',
  DawnOfTheMachine: 'mg3',
}

export type OfficialGame = typeof officialGame

export type GameDefinition = {
  game: OfficialGame[keyof OfficialGame],
  name: MapName,
  shortName: string,
  author: string,
  sourceId: SourceId,
  defaultMap: string,
  type: 'official' | 'quaddicted' | 'custom'
  mapList: GameMap[]
  /** Eyebrow label shown above the pack name. */
  label: string
  /** True for packs that load id1's registered assets and so need pak1. */
  requiresRegistration?: boolean
  /** Bundled cover image, for packs the remote thumbnail service has no shots of. */
  artwork?: string
}


export const officialGameDefinitions: GameDefinition[] = [{
  game: officialGame.Original,
  name: 'Quake',
  shortName: 'Quake',
  author: 'id Software · 1996',
  sourceId: 'official:original',
  defaultMap: 'start',
  mapList: originalMaps,
  type: 'official',
  label: 'Base Game'
}, {
  game: officialGame.Hipnotic,
  name: 'Mission Pack 1: Scourge of Armagon',
  shortName: 'Scourge of Armagon',
  author: 'Hipnotic Interactive · 1997',
  sourceId: 'official:hipnotic',
  defaultMap: 'start',
  mapList: hipnotic,
  type: 'official',
  label: 'Mission Pack 1',
  requiresRegistration: true
}, {
  game: officialGame.Rogue,
  name: 'Mission Pack 2: Dissolution of Eternity',
  shortName: 'Dissolution of Eternity',
  author: 'Rogue Entertainment · 1997',
  sourceId: 'official:rogue',
  defaultMap: 'start',
  mapList: rogue,
  type: 'official',
  label: 'Mission Pack 2',
  requiresRegistration: true
}, {
  game: officialGame.DimensionOfTheMachine,
  name: 'Dimension of the Machine',
  shortName: 'Dimension of the Machine',
  author: 'MachineGames · 2021',
  sourceId: 'official:mg1',
  defaultMap: 'start',
  mapList: mg1,
  type: 'official',
  label: 'Re-release Episode',
  requiresRegistration: true,
  artwork: dimensionOfTheMachineArt
}, {
  game: officialGame.DawnOfTheMachine,
  name: 'Dawn of the Machine',
  shortName: 'Dawn of the Machine',
  author: 'MachineGames · 2026',
  sourceId: 'official:mg3',
  defaultMap: 'start',
  mapList: mg3,
  type: 'official',
  label: 'Anniversary Episode',
  requiresRegistration: true,
  artwork: dawnOfTheMachineArt
}]

export const parseSourceId = (sourceId: SourceId) => {
  const [type, id] = sourceId.split(':')
  return {type, id} as {type: SourceId extends `${infer T}:${string}` ? T : never, id: string}
}