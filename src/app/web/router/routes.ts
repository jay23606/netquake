import { RouteRecordRaw } from 'vue-router'
import Home from '../components/page/Home.vue'
import Privacy from '../components/page/Privacy/Privacy.vue'
import Faq from '../components/page/Faq.vue'
import Multiplayer from '../components/page/Multiplayer/Multiplayer.vue'
import Singleplayer from '../components/page/Singleplayer/Singleplayer.vue'

import Setup from '../components/page/Setup/Setup.vue'
import Config from '../components/page/Setup/Config.vue'
import Autoexec from '../components/page/Setup/Autoexec.vue'
import SetupGame from '../components/page/Setup/SetupGame/SetupGame.vue'
import GameLauncher from '../components/page/Game/GameLauncher.vue'
import RoomHub from '../components/page/Room/RoomHub.vue'
import Room from '../components/page/Room/Room.vue'
import SharewareLicense from '../components/page/SharewareLicense.vue'
import Frontend from '../components/layout/Layout.vue'
import RoomGameLauncher from '../components/page/Room/RoomGameLauncher.vue'
import SupabaseLobby from '../components/page/SupabaseMp/SupabaseLobby.vue'
import SupabaseGameLauncher from '../components/page/SupabaseMp/SupabaseGameLauncher.vue'

const routes: RouteRecordRaw[] = [
  { 
    path: '/', 
    component: Frontend,
    children: [
      { path: '/', component: Home },
      { name: 'privacy', path: '/privacy', component: Privacy },
      { name: 'multiplayer', path: '/multiplayer', component: Multiplayer },
      { name: 'singleplayer', path: '/singleplayer', component: Singleplayer },
      { name: 'room', path: '/room/:id', component: Room },
      { name: 'setup', path: '/setup', component: Setup },
      { name: 'faq', path: '/faq', component: Faq },
      { name: "slicnse", path: "/slicnse", component: SharewareLicense },
      { name: "sb-multiplayer", path: "/mp", component: SupabaseLobby }
    ]
  },
  { 
    name: 'room-game', 
    path: '/room/:roomId/quake', 
    component: RoomGameLauncher,
    props: true  
  },
  {
    name: "sb-quake",
    path: "/mp/quake",
    component: SupabaseGameLauncher,
    props: true
  },
  { 
    name: "quake", 
    path: '/quake', 
    component: GameLauncher,
    props: true 
  },
]

export default routes