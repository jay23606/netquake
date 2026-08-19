import { SourceId } from "../../../shared/types/Source"

const imagePath = import.meta.env.VITE_THUMBNAILS_PATH
const generic = `${imagePath}/generic.jpg`


export const genericImageUrl = imagePath + '/generic.jpg'
export const getQuaddictedImageUrl = (mapId: string, fileName: string) => {
  const mapName = fileName.substring(0, fileName.lastIndexOf('.'))
  return `https://www.quaddicted.com/files/quaddicted-images/by-sha256/${mapId.slice(0, 2)}/${mapId}/${mapName}.jpg`
}
export const getMapImageUrl = (name?: string, gameDir?: string) => {
  if (!name) return genericImageUrl
  const prefix = gameDir && gameDir !== 'original' ? `${gameDir}/` : ''
  return `${imagePath}/${prefix}${name}.jpg`
}
export const sharewareMaps = ['start', 'e1m1', 'e1m2', 'e1m3', 'e1m4', 'e1m5', 'e1m6', 'e1m7', 'e1m8']

// Best guess at a package's entry map: a start hub, an intro, anything named
// like a start hub (e.g. cstart), else the first map.
export const guessStartMap = (mapList: string[]): string | undefined => {
  const lower = mapList.map(m => m.toLowerCase())
  const pick = (test: (m: string) => boolean) => {
    const idx = lower.findIndex(test)
    return idx === -1 ? undefined : mapList[idx]
  }
  return pick(m => m === 'start')
    ?? pick(m => m === 'intro')
    ?? pick(m => m.endsWith('start'))
    ?? mapList[0]
}
export const isMap = (name: string) => /^maps\/[^\\\/:*?"<>|]+\.bsp$/.test(name)
export const isPak = (name: string) => /^.+\.pak$/.test(name)

// The only game dirs the engine takes as a bare flag (com.checkParm); everything
// else is a plain -game directory.
const missionPackGameDirs = ['hipnotic', 'rogue']

export const getMapGameQueryParams = ({map, sourceId, gameDir}: {map: string, sourceId: SourceId, gameDir?: string}) => {

  const query: Record<string, any> = { '+map': map }
  if (sourceId.split(':')[0] === 'official') {
    if (gameDir && gameDir !== 'original') {
      if (missionPackGameDirs.includes(gameDir)) {
        query['-' + gameDir] = true
      } else {
        query['-game'] = gameDir
      }
    }
  } else {
    query['sourceId'] = sourceId
    if (gameDir) {
      query['-game'] = gameDir
    }
  }

  return query
}