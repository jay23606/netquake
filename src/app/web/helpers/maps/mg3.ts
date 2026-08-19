import { GameMap } from "../games";

// Titles and sp/dm flags come from the re-release's own id1/pak0.pak mapdb.json,
// resolved through localization/loc_english.txt.
export default [
  {
    name: 'start',
    title: 'The Thirtieth Passing',
    collection: ''
  },
  {
    name: 'hub',
    title: 'The Runic Nexus',
    collection: ''
  },
  {
    name: 'map1',
    title: 'Through the First Arch',
    collection: 'Campaign'
  },
  {
    name: 'map2',
    title: 'Dawn of the All Mother',
    collection: 'Campaign'
  },
  {
    name: 'map2b',
    title: 'Into the Abyss of Time',
    collection: 'Campaign'
  },
  {
    name: 'secret1',
    title: 'The Sundered Column',
    collection: 'Secrets'
  },
  {
    name: 'map3',
    title: 'Veils of the Old Ones',
    collection: 'Campaign'
  },
  {
    name: 'secret2',
    title: 'The Nightmare Machine',
    collection: 'Secrets'
  },
  {
    name: 'map4',
    title: 'Of Shattered Minds',
    collection: 'Campaign'
  },
  {
    name: 'map5',
    title: 'Requiem',
    collection: 'Campaign'
  },
  {
    name: 'secret3',
    title: 'Mist of Torment',
    collection: 'Secrets'
  },
  {
    name: 'map6',
    title: 'The Matriarch of Decay',
    collection: 'Campaign'
  },
  {
    name: 'secret4',
    title: 'The Crooked Village',
    collection: 'Secrets'
  },
  {
    name: 'map7',
    title: 'Revelation of the Arcane',
    collection: 'Campaign'
  },
  {
    name: 'secret5',
    title: 'House of Delusion',
    collection: 'Secrets'
  },
  {
    name: 'map8',
    title: 'The Sacrifice',
    collection: 'Campaign'
  },
  {
    name: 'secret6',
    title: 'The Haunted Tower',
    collection: 'Secrets'
  },
  {
    name: 'boss',
    title: 'The Sleeper Awakens',
    collection: 'Finale'
  },
  {
    name: 'boss2',
    title: 'A Dancing God',
    collection: 'Finale'
  },
  {
    name: 'dm1',
    title: 'The Crooked Place',
    collection: 'Deathmatch',
    sp: false
  },
] as GameMap[]
