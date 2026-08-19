/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

interface ImportMetaEnv {
  readonly VITE_ALLOW_SERVER_DOWNLOADS: string
  readonly VITE_THUMBNAILS_PATH: string
  readonly VITE_ROOM_SERVER_URL: string
  readonly VITE_ROOM_SERVER_SOCKET_URL: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_ICE_SERVERS: string
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
