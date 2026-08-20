import { RouteRecordRaw } from 'vue-router'
import Home from '../components/page/Home.vue'
import Privacy from '../components/page/Privacy/Privacy.vue'
import Faq from '../components/page/Faq.vue'
import Singleplayer from '../components/page/Singleplayer/Singleplayer.vue'

import Setup from '../components/page/Setup/Setup.vue'
import Config from '../components/page/Setup/Config.vue'
import Autoexec from '../components/page/Setup/Autoexec.vue'
import SetupGame from '../components/page/Setup/SetupGame/SetupGame.vue'
import GameLauncher from '../components/page/Game/GameLauncher.vue'
import SharewareLicense from '../components/page/SharewareLicense.vue'
import Frontend from '../components/layout/Layout.vue'
import SupabaseLobby from '../components/page/SupabaseMp/SupabaseLobby.vue'
import Leaderboard from '../components/page/Leaderboard.vue'
import SupabaseGameLauncher from '../components/page/SupabaseMp/SupabaseGameLauncher.vue'

const routes: RouteRecordRaw[] = [
  { 
    path: '/', 
    component: Frontend,
    children: [
      { path: '/', component: Home },
      { name: 'privacy', path: '/privacy', component: Privacy },
      { name: 'singleplayer', path: '/singleplayer', component: Singleplayer },
      { name: 'setup', path: '/setup', component: Setup },
      { name: 'faq', path: '/faq', component: Faq },
      { name: "slicnse", path: "/slicnse", component: SharewareLicense },
      { name: "sb-multiplayer", path: "/mp", component: SupabaseLobby },
      { name: "leaderboard", path: "/leaderboard", component: Leaderboard }
    ]
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