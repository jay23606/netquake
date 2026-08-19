import * as indexedDb from '../../../shared/indexeddb'
import { defineStore } from 'pinia'
import type { AssetMeta, PackageMeta } from '../../../shared/types/Store'
import { NameValue } from '../types/NameValue'
import { getBindInConfig, getValueInConfig } from '../helpers/config'

export type ConfigType = 'classic' | 'modern' | 'custom'

const theseShouldBeSet = [
  {name: 'cl_forwardspeed', value: '400'},
  {name: 'cl_backspeed', value: '400'},
  {name: 'crosshair', value: '1'},
  {name: 'm_filter', value: '1'}
]
const modernBinds = [
  {name: 'MOUSE1', value: '+attack'},
  {name: 'MOUSE2', value: '+jump'},
  {name: 'w', value: '+forward'},
  {name: 's', value: '+back'},
  {name: 'a', value: '+moveleft'},
  {name: 'd', value: '+moveright'},
  {name: 'ENTER', value: 'messagemode'},
  {name: 't', value: 'messagemode'},
  {name: 'y', value: 'messagemode2'}
]

const classicBinds = [
  {name: 'UPARROW', value: '+forward'},
  {name: 'DOWNARROW', value: '+back'},
  {name: 'LEFTARROW', value: '+left'},
  {name: 'RIGHTARROW', value: '+right'},
  {name: 'ALT', value: '+strafe'},
  {name: 'COMMAND', value: '+attack'},
  {name: 'CTRL', value: '+attack'},
  {name: 'a', value: '+lookup'},
  {name: 'z', value: '+lookdown'},
  {name: 'ENTER', value: 'messagemode'},
  {name: 't', value: 'messagemode'},
  {name: 'y', value: 'messagemode2'}
]

const baseCfg = 
`bind "TAB" "+showscores"
bind "ENTER" "messagemode"
bind "ESCAPE" "togglemenu"
bind "SPACE" "+jump"
bind "+" "sizeup"
bind "," "+moveleft"
bind "-" "sizedown"
bind "." "+moveright"
bind "/" "impulse 10"
bind "0" "impulse 0"
bind "1" "impulse 1"
bind "2" "impulse 2"
bind "3" "impulse 3"
bind "4" "impulse 4"
bind "5" "impulse 5"
bind "6" "impulse 6"
bind "7" "impulse 7"
bind "8" "impulse 8"
bind "=" "sizeup"
bind "\\" "+mlook"
bind "\`" "toggleconsole"
bind "c" "+movedown"
bind "d" "+moveup"
bind "t" "messagemode"
bind "y" "messagemode2"
bind "~" "toggleconsole"
bind "w" "+forward"
bind "s" "+back"
bind "a" "+moveleft"
bind "d" "+moveright"
bind "UPARROW" "+forward"
bind "DOWNARROW" "+back"
bind "LEFTARROW" "+left"
bind "RIGHTARROW" "+right"
bind "ALT" "+strafe"
bind "COMMAND" "+attack"
bind "CTRL" "+attack"
bind "F1" "help"
bind "F2" "menu_save"
bind "F3" "menu_load"
bind "F4" "menu_options"
bind "F5" "menu_multiplayer"
bind "F6" "echo Quicksaving...; wait; save quick"
bind "F9" "echo Quickloading...; wait; load quick"
bind "F10" "quit"
bind "F11" "zoom_in"
bind "F12" "screenshot"
bind "INS" "+klook"
bind "DEL" "+lookdown"
bind "PGDN" "+lookup"
bind "END" "centerview"
bind "MOUSE1" "+attack"
bind "MOUSE2" "+jump"
bind "PAUSE" "pause"
crosshair "1"
gamma "0.7"
savedgamecfg "0"
saved1 "0"
saved2 "0"
saved3 "0"
saved4 "0"
viewsize "100"
volume "0.7"
bgmvolume "1"
_cl_color "0"
cl_forwardspeed "400"
cl_backspeed "400"
lookspring "0"
lookstrafe "0"
sensitivity "3"
m_filter "1"
m_pitch "0.022"
m_yaw "0.022"
m_forward "1"
m_side "0.8"`

const recommendedAutoexec = `+mlook
bind e "impulse 22" // Hook
`

const configFileName = 'Quake.id1/config.cfg'
const autoExecFileName = 'Quake.id1/autoexec.cfg'

interface State {
  assetMetas: AssetMeta[],
  packages: PackageMeta[]
  configFile: string
  autoexecFile: string
  newGameType: string
  pak1ModalOpen: boolean
}
const setBindInConfig = (cfg: string, nameValue: NameValue) => {
  const match = getBindInConfig(cfg, nameValue.name)
  const newSetting = `bind "${nameValue.name}" "${nameValue.value}"`
  if (match) {
    const newConfig = [
      cfg.substring(0,match.index),
      newSetting,
      cfg.substring(match.index + match.length, cfg.length)
    ]
    return newConfig.join('')
  } else {
    return cfg +'\n' + newSetting
  }
}

const setValueInConfig = (cfg: string, nameValue: NameValue) => {
  const match = getValueInConfig(cfg, nameValue.name)
  const newSetting = `${nameValue.name} "${nameValue.value}"`
  if (match) {
    const newConfig = [
      cfg.substring(0,match.index),
      newSetting,
      cfg.substring(match.index + match.length, cfg.length)
    ]
    return newConfig.join('')
  } else {
    return cfg +'\n' + newSetting
  }
}

export const useGameStore = defineStore('game', {
  state: (): State => ({
    assetMetas: [],
    packages: [],
    configFile: '',
    autoexecFile: '',
    newGameType: '',
    pak1ModalOpen: false
  }),
  getters: {
    getConfigValue: (state: State) => (name: string) => {
      const match = getValueInConfig(state.configFile, name)
      return match ? match.value : null
    },
    getCurrentConfigType: (state: State) => {
      const classicArtifact = /bind "a" "\+lookup"/
      const modernArtifact = /bind "a" "\+moveleft"/

      return state.configFile.match(classicArtifact) ? 'classic' :
        state.configFile.match(modernArtifact) ? 'modern' : 'custom'
    },
    getAutoexecValue: (state: State) => (name: string) => {
      const match = getValueInConfig(state.autoexecFile, name)
      return match ? match.value : null
    },
    hasRegistered: (state: State) => state.assetMetas.some(a => a.game === 'id1' && a.fileName.toLowerCase() === 'pak1.pak'),
    hasGame: (state: State) => (game: string) => state.assetMetas.some(a => a.game === game)
  },
  actions: {
    // setAssetMetas (assetMetas: AssetMeta[]) {
    //   this.assetMetas = assetMetas
    // },
    // setConfigFile (configFile: string) {
    //   this.configFile = configFile || ''
    // },
    // setAutoexecFile (autoexecFile: string) {
    //   this.autoexecFile = autoexecFile || ''
    // },
    loadConfig () {
      const configFile = localStorage[configFileName]
      this.configFile = configFile || ''
    },
    saveConfig (configFile: string) {
      localStorage[configFileName] = configFile
      this.configFile = configFile || ''
    },
    loadClassicConfig () {
      classicBinds.map(bind => this.setConfigBind(bind))
      theseShouldBeSet.map(bind => this.setConfigValue(bind))
    },
    loadModernConfig () {
      modernBinds.map(bind => this.setConfigBind(bind))
      theseShouldBeSet.map(bind => this.setConfigValue(bind))
    },
    loadAutoexec () {
      const autoexecFile = localStorage[autoExecFileName]
      this.autoexecFile = autoexecFile || ''
    },
    saveAutoexec (autoexecFile: string) {
      localStorage[autoExecFileName] = autoexecFile
      this.autoexecFile = autoexecFile || ''
    },
    setConfigBind (nameValue: NameValue) {
      this.saveConfig(setBindInConfig(this.configFile, nameValue))
    },
    setAutoexecValue (nameValue: NameValue) {
      this.saveAutoexec(setValueInConfig(this.autoexecFile, nameValue))
    },
    setConfigValue (nameValue: NameValue) {
      this.saveConfig(setValueInConfig(this.configFile, nameValue))
    },
    loadRecommendedConfig () {
      this.saveConfig(baseCfg)
      this.loadModernConfig()
    },
    loadRecommendedAutoexec () {
      this.saveAutoexec(recommendedAutoexec)
    },
    loadAssets () {
      return indexedDb.getAllMeta()
        .then(allAssets => {
          this.assetMetas = allAssets
        })
    },
    // Backfill sha256 for id1 paks saved before checksums existed, so the
    // setup page can verify them against the official release.
    async ensurePakChecksums () {
      if (this.assetMetas.length === 0) await this.loadAssets()
      const paks = this.assetMetas.filter((am: AssetMeta) =>
        am.game === 'id1' &&
        (am.fileName.toLowerCase() === 'pak0.pak' || am.fileName.toLowerCase() === 'pak1.pak') &&
        !am.sha256
      )
      if (paks.length === 0) return
      let updated = false
      for (const meta of paks) {
        const asset = await indexedDb.getAsset('id1', meta.fileName)
        if (!asset) continue
        const hash = await indexedDb.sha256Hex(asset.data)
        if (!hash) return // no crypto.subtle on this origin; nothing can be hashed
        await indexedDb.updateAssetChecksum(String(meta.assetId), hash)
        updated = true
      }
      if (updated) await this.loadAssets()
    },
    async loadPackages () {
      const pkgs = await indexedDb.getAllPackages()
      this.packages = pkgs.sort((a, b) => {
        const aCustom = a.sourceId.startsWith('custom:')
        const bCustom = b.sourceId.startsWith('custom:')
        if (aCustom && !bCustom) return -1
        if (!aCustom && bCustom) return 1
        return 0
      })
    },
    saveAsset ({
      game, 
      fileName,
      fileCount, 
      data}: {game: string, fileName: string, fileCount: number, data: ArrayBuffer}) {
      return indexedDb.saveAsset(game, fileName, fileCount, data, null)
        .then(() => this.loadAssets())
    },
    removeAsset (assetId: string) {
      return indexedDb.removeAsset(assetId)
        .then(() => this.loadAssets())
    },
    openPak1Modal () { this.pak1ModalOpen = true },
    closePak1Modal () { this.pak1ModalOpen = false },
    async removePackage (packageId: number) {
      await indexedDb.removePackage(packageId)
      await Promise.all([this.loadPackages(), this.loadAssets()])
    }
  }
})