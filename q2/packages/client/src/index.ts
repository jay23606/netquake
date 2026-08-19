/**
 * File: q_shared.ts
 * Purpose: Expose the first ported Quake II client runtime structures and parsing routines.
 *
 * This file is not a direct source port.
 * It is a package entry point for early client-side runtime modules.
 *
 * Dependencies:
 * - packages/client/src/client.ts
 * - packages/client/src/cl_parse.ts
 */

export {
  CON_TEXTSIZE,
  NUM_CON_TIMES,
  Con_CheckResize,
  Con_Clear_f,
  Con_ClearNotify,
  Con_CenteredPrint,
  Con_DrawCharacter,
  Con_DrawConsole,
  Con_DrawInput,
  Con_DrawNotify,
  Con_Dump_f,
  Con_Init,
  Con_MessageMode2_f,
  Con_MessageMode_f,
  Con_Print,
  Con_SyncConsoleToKeys,
  Con_SyncKeysToConsole,
  Con_ToggleChat_f,
  Con_ToggleConsole_f,
  DrawAltString,
  DrawString,
  Key_ClearTyping,
  createClientConsoleContext,
  createConsoleState
} from "./console.js";
export {
  KEY_LINE_COUNT,
  KEY_ARRAY_SIZE,
  MAXCMDLINE,
  K_ALT,
  K_AUX1,
  K_AUX2,
  K_AUX3,
  K_AUX4,
  K_AUX5,
  K_AUX6,
  K_AUX7,
  K_AUX8,
  K_AUX9,
  K_AUX10,
  K_AUX11,
  K_AUX12,
  K_AUX13,
  K_AUX14,
  K_AUX15,
  K_AUX16,
  K_AUX17,
  K_AUX18,
  K_AUX19,
  K_AUX20,
  K_AUX21,
  K_AUX22,
  K_AUX23,
  K_AUX24,
  K_AUX25,
  K_AUX26,
  K_AUX27,
  K_AUX28,
  K_AUX29,
  K_AUX30,
  K_AUX31,
  K_AUX32,
  K_BACKSPACE,
  K_CTRL,
  K_DEL,
  K_DOWNARROW,
  K_END,
  K_ENTER,
  K_ESCAPE,
  K_F1,
  K_F2,
  K_F3,
  K_F4,
  K_F5,
  K_F6,
  K_F7,
  K_F8,
  K_F9,
  K_F10,
  K_F11,
  K_F12,
  K_HOME,
  K_INS,
  K_JOY1,
  K_JOY2,
  K_JOY3,
  K_JOY4,
  K_KP_5,
  K_KP_DEL,
  K_KP_DOWNARROW,
  K_KP_END,
  K_KP_ENTER,
  K_KP_HOME,
  K_KP_INS,
  K_KP_LEFTARROW,
  K_KP_MINUS,
  K_KP_PGDN,
  K_KP_PGUP,
  K_KP_PLUS,
  K_KP_RIGHTARROW,
  K_KP_SLASH,
  K_KP_UPARROW,
  K_LEFTARROW,
  K_MOUSE1,
  K_MOUSE2,
  K_MOUSE3,
  K_MWHEELDOWN,
  K_MWHEELUP,
  K_PAUSE,
  K_PGDN,
  K_PGUP,
  K_RIGHTARROW,
  K_SHIFT,
  K_SPACE,
  K_TAB,
  K_UPARROW,
  CompleteCommand,
  Key_Bind_f,
  Key_Bindlist_f,
  Key_ClearStates,
  Key_Console,
  Key_Event,
  Key_GetKey,
  Key_Init,
  Key_KeynumToString,
  Key_Message,
  Key_SetBinding,
  Key_StringToKeynum,
  Key_Unbind_f,
  Key_Unbindall_f,
  Key_WriteBindings,
  createClientKeyContext,
  keydest_t,
  keynames
} from "./keys.js";
export {
  MAXMENUITEMS,
  MTYPE_ACTION,
  MTYPE_FIELD,
  MTYPE_LIST,
  MTYPE_SEPARATOR,
  MTYPE_SLIDER,
  MTYPE_SPINCONTROL,
  QMF_GRAYED,
  QMF_LEFT_JUSTIFY,
  QMF_NUMBERSONLY,
  Field_Key,
  Menu_AddItem,
  Menu_AdjustCursor,
  Menu_Center,
  Menu_Draw,
  Menu_DrawString,
  Menu_DrawStringDark,
  Menu_DrawStringR2L,
  Menu_DrawStringR2LDark,
  Menu_ItemAtCursor,
  Menu_SelectItem,
  Menu_SetStatusBar,
  Menu_SlideItem,
  Menu_TallySlots,
  createClientQMenuContext,
  createMenuAction,
  createMenuCommon,
  createMenuField,
  createMenuFramework,
  createMenuList,
  createMenuSeparator,
  createMenuSlider
} from "./qmenu.js";
export {
  Create_Savestrings,
  Default_MenuKey,
  Game_MenuInit,
  Game_MenuKey,
  AddressBook_MenuInit,
  AddressBook_MenuKey,
  DMFlagCallback,
  DMOptions_MenuInit,
  DMOptions_MenuKey,
  DownloadCallback,
  DownloadOptions_MenuInit,
  DownloadOptions_MenuKey,
  JoinServer_MenuInit,
  JoinServer_MenuKey,
  Keys_MenuInit,
  Keys_MenuKey,
  LoadGame_MenuInit,
  LoadGame_MenuKey,
  M_AddToServerList,
  M_Banner,
  M_Credits_Key,
  M_Credits_MenuDraw,
  M_Draw,
  M_DrawCharacter,
  M_DrawCursor,
  M_DrawPic,
  M_DrawTextBox,
  M_ForceMenuOff,
  M_Init,
  M_Keydown,
  M_Menu_Keys_f,
  M_Menu_AddressBook_f,
  M_Menu_Credits_f,
  M_Menu_DMOptions_f,
  M_Menu_DownloadOptions_f,
  M_Menu_JoinServer_f,
  M_Menu_StartServer_f,
  M_Menu_LoadGame_f,
  M_Menu_Main_f,
  M_Menu_Multiplayer_f,
  M_Menu_Options_f,
  M_Menu_PlayerConfig_f,
  M_Menu_Quit_f,
  M_Menu_SaveGame_f,
  M_Menu_Video_f,
  Options_MenuInit,
  Options_MenuKey,
  PlayerConfig_MenuInit,
  PlayerConfig_MenuKey,
  PlayerConfig_ScanDirectories,
  M_PopMenu,
  M_Print,
  M_PrintWhite,
  M_PushMenu,
  Multiplayer_MenuInit,
  Multiplayer_MenuKey,
  StartServer_MenuInit,
  StartServer_MenuKey,
  SaveGame_MenuInit,
  SaveGame_MenuKey,
  createClientMenuContext,
  idcredits,
  pmicmpfnc,
  roguecredits,
  xatcredits
} from "./menu.js";
export {
  CL_ClearState,
  CL_ParseBaseline,
  CL_ParseConfigString,
  CL_ParseDownload,
  CL_ParseBeam,
  CL_ParseBeam2,
  CL_ParseDelta,
  CL_ParseEntityBits,
  CL_ParseFrame,
  CL_ParseLaser,
  CL_ParseLightning,
  CL_LoadClientinfo,
  CL_ParseClientinfo,
  CL_ParseInventory,
  CL_ParseLayout,
  CL_ParseMuzzleFlash,
  CL_ParseMuzzleFlash2,
  CL_ParseNuke,
  CL_ParseParticles,
  CL_ParsePlayerBeam,
  CL_ParsePlayerstate,
  CL_ParseServerData,
  CL_ParseServerMessage,
  CL_ParseSteam,
  CL_ParseStartSoundPacket,
  CL_ParseTEnt,
  CL_ParseWidow,
  SHOWNET,
  CL_WriteStringCmd
} from "./cl_parse.js";
export {
  CL_CheckOrDownloadFile,
  CL_Download_f,
  CL_DownloadFileName
} from "./download.js";
export {
  ENV_CNT,
  CL_Precache_f,
  CL_RequestNextDownload,
  PLAYER_MULT,
  TEXTURE_CNT,
  env_suf
} from "./precache.js";
export {
  CL_RegisterSounds
} from "./sound-registration.js";
export {
  API_VERSION,
  ENTITY_FLAGS,
  MAX_DLIGHTS as REF_MAX_DLIGHTS,
  MAX_ENTITIES as REF_MAX_ENTITIES,
  MAX_LIGHTSTYLES as REF_MAX_LIGHTSTYLES,
  MAX_PARTICLES as REF_MAX_PARTICLES,
  POWERSUIT_SCALE,
  SHELL_BG_COLOR,
  SHELL_BLUE_COLOR,
  SHELL_CYAN_COLOR,
  SHELL_DOUBLE_COLOR,
  SHELL_GREEN_COLOR,
  SHELL_HALF_DAM_COLOR,
  SHELL_RB_COLOR,
  SHELL_RED_COLOR,
  SHELL_RG_COLOR,
  SHELL_WHITE_COLOR,
  createDlight as createRefDlight,
  createEntity as createRefEntity,
  createLightstyle as createRefLightstyle,
  createParticle as createRefParticle,
  createRefDef,
  createRefExport,
  createRefImport
} from "./ref.js";
export {
  VID_CheckChanges,
  VID_Init,
  VID_MenuDraw,
  VID_MenuInit,
  VID_MenuKey,
  VID_Shutdown,
  createClientVidContext,
  createVidDef
} from "./vid.js";
export {
  createClientVidMenuController
} from "./vid-menu.js";
export type {
  ClientVidMenuController,
  ClientVidMenuHooks
} from "./vid-menu.js";
export {
  CDAudio_Activate,
  CDAudio_Init,
  CDAudio_Pause,
  CDAudio_Play,
  CDAudio_Resume,
  CDAudio_Shutdown,
  CDAudio_Stop,
  CDAudio_Update,
  createClientCDAudioContext
} from "./cdaudio.js";
export type {
  ClientCDAudioContext,
  ClientCDAudioHooks,
  ClientCDAudioState
} from "./cdaudio.js";
export {
  CL_GetEntitySoundOrigin,
  S_Activate,
  S_BeginRegistration,
  S_EndRegistration,
  S_FindName,
  S_Init,
  S_RawSamples,
  S_RegisterSound,
  S_Shutdown,
  S_StartLocalSound,
  S_StartSound,
  S_StopAllSounds,
  S_Update,
  createClientSoundPublicContext,
  createRawSampleBuffer
} from "./sound.js";
export {
  DumpChunks,
  ResampleSfx,
  cache_full_cycle
} from "./snd_mem.js";
export {
  S_AddLoopSounds,
  S_AliasName as S_DMA_AliasName,
  S_AllocPlaysound as S_DMA_AllocPlaysound,
  S_BeginRegistration as S_DMA_BeginRegistration,
  S_ClearBuffer as S_DMA_ClearBuffer,
  S_EndRegistration as S_DMA_EndRegistration,
  S_FindName as S_DMA_FindName,
  S_FreePlaysound as S_DMA_FreePlaysound,
  S_IssuePlaysound as S_DMA_IssuePlaysound,
  S_Init as S_DMA_Init,
  S_PickChannel as S_DMA_PickChannel,
  S_Play as S_DMA_Play,
  S_RawSamples as S_DMA_RawSamples,
  S_RegisterSexedSound as S_DMA_RegisterSexedSound,
  S_RegisterSound as S_DMA_RegisterSound,
  S_Shutdown as S_DMA_Shutdown,
  S_SoundInfo as S_DMA_SoundInfo,
  S_SoundList as S_DMA_SoundList,
  S_Spatialize as S_DMA_Spatialize,
  S_SpatializeOrigin as S_DMA_SpatializeOrigin,
  S_StartLocalSound as S_DMA_StartLocalSound,
  S_StartSound as S_DMA_StartSound,
  S_StopAllSounds as S_DMA_StopAllSounds,
  S_Update as S_DMA_Update,
  S_Update_ as S_DMA_Update_,
  GetSoundtime as S_DMA_GetSoundtime,
  createClientSndDmaContext,
  createClientSndDmaState
} from "./snd_dma.js";
export {
  PAINTBUFFER_SIZE,
  S_PaintChannelFrom8,
  S_PaintChannelFrom16,
  S_TransferPaintBuffer,
  S_TransferStereo16,
  S_WriteLinearBlastStereo16,
  createClientSoundMixState
} from "./snd_mix.js";
export {
  MAX_CHANNELS,
  MAX_RAW_SAMPLES,
  GetWavinfo,
  S_InitScaletable,
  S_IssuePlaysound,
  S_LoadSound,
  S_PaintChannels,
  S_PickChannel,
  S_Spatialize,
  SNDDMA_BeginPainting,
  SNDDMA_GetDMAPos,
  SNDDMA_Init,
  SNDDMA_Shutdown,
  SNDDMA_Submit,
  createChannel,
  createClientSoundLocalContext,
  createDmaState,
  createPlaySound,
  createPortableSamplePair,
  createSfx,
  createSfxCache,
  createWavInfo,
  getSoundNameCapacity
} from "./snd_loc.js";
export {
  SCR_AddDirtyPoint,
  SCR_BeginLoadingPlaque,
  SCR_CenterPrint,
  SCR_DebugGraph,
  SCR_DirtyScreen,
  SCR_DrawCinematic,
  SCR_EndLoadingPlaque,
  SCR_FinishCinematic,
  SCR_Init,
  SCR_PlayCinematic,
  SCR_RunCinematic,
  SCR_RunConsole,
  SCR_SizeDown,
  SCR_SizeUp,
  SCR_StopCinematic,
  SCR_TouchPics,
  SCR_UpdateScreen,
  createClientScreenState
} from "./screen.js";
export {
  CL_AddNetgraph,
  DrawHUDString,
  DrawHUDStringRef,
  createClientScreenContext,
  SCR_BuildHudDrawCommands,
  SCR_DrawHudRef,
  SCR_DrawConsole,
  SCR_DrawLoading,
  SCR_DrawNet,
  SCR_DrawPause,
  SCR_DrawCinematicRef,
  SCR_DrawCrosshairRef,
  SCR_DrawDebugGraph,
  SCR_ExecuteLayoutString,
  SCR_ExecuteLayoutStringRef,
  SCR_DrawField,
  SCR_DrawFieldRef,
  SCR_DrawLayout,
  SCR_DrawLayoutRef,
  SCR_DrawStats,
  SCR_DrawStatsRef,
  SCR_TileClear,
  SCR_TileClearRef,
  SizeHUDString,
  SCR_BuildScreenState,
  SCR_CheckDrawCenterString,
  SCR_Loading_f,
  SCR_Sky_f,
  SCR_TimeRefresh_f
} from "./cl_scrn.js";
export {
  CL_DrawInventory,
  CL_DrawInventoryRef,
  DISPLAY_ITEMS,
  Inv_DrawString,
  Inv_DrawStringRef,
  SetStringHighBit
} from "./cl_inv.js";
export type {
  ClientCinematicSnapshot,
  ClientScreenHooks
} from "./cl_cin.js";
export type {
  ClientInventoryBindingMap
} from "./cl_inv.js";
export {
  findClientImageIndex as findLocalClientImageIndex,
  initializeLocalHudState as initializeLocalClientHudState,
  setLocalLayoutBit,
  toggleLocalLayoutBit
} from "./local-client-bootstrap.js";
export {
  CL_FixUpGender,
  Cmd_ForwardToServer,
  CL_Changing_f,
  CL_CheckForResend,
  CL_ConnectionlessPacket,
  CL_Connect_f,
  CL_DumpPackets,
  CL_Drop,
  CL_Disconnect,
  CL_Disconnect_f,
  CL_Frame,
  CL_FixCvarCheats,
  CL_ForwardToServer_f,
  CL_Init,
  CL_InitLocal,
  CL_Packet_f,
  CL_ParseStatusMessage,
  CL_Pause_f,
  CL_PingServers_f,
  CL_Quit_f,
  CL_Record_f,
  CL_Rcon_f,
  CL_Reconnect_f,
  CL_SendConnectPacket,
  CL_SendCommand,
  CL_ReadPackets,
  CL_Shutdown,
  CL_Setenv_f,
  CL_Snd_Restart_f,
  CL_Skins_f,
  CL_Stop_f,
  CL_TogglePause,
  CL_Userinfo_f,
  CL_WriteDemoMessage,
  CL_WriteConfiguration,
  createClientMainContext
} from "./cl_main.js";
export {
  CL_AdjustAngles,
  CL_BaseMove,
  CL_ClampPitch,
  CL_CreateCmd,
  CL_FinishMove,
  CL_InitInput,
  CL_KeyState,
  CL_SendCmd,
  CL_SetInputFrameTime,
  createClientSendCmdBridge,
  IN_AttackDown,
  IN_AttackUp,
  IN_BackDown,
  IN_BackUp,
  IN_CenterView,
  IN_DownDown,
  IN_DownUp,
  IN_ForwardDown,
  IN_ForwardUp,
  IN_Impulse,
  IN_KLookDown,
  IN_KLookUp,
  IN_LeftDown,
  IN_LeftUp,
  IN_LookdownDown,
  IN_LookdownUp,
  IN_LookupDown,
  IN_LookupUp,
  IN_MoveleftDown,
  IN_MoveleftUp,
  IN_MoverightDown,
  IN_MoverightUp,
  IN_RightDown,
  IN_RightUp,
  IN_SpeedDown,
  IN_SpeedUp,
  IN_StrafeDown,
  IN_StrafeUp,
  IN_UpDown,
  IN_UpUp,
  IN_UseDown,
  IN_UseUp,
  KeyDown,
  KeyUp,
  createClientInputContext
} from "./cl_input.js";
export {
  IN_Activate,
  IN_Commands,
  IN_Frame,
  IN_Init,
  IN_Move,
  IN_Shutdown,
  createClientInputDeviceContext,
  createClientInputDeviceMainHooks
} from "./input.js";
export {
  applyLocalMovementMode,
  buildLocalPredictedViewState,
  cloneLocalUsercmd,
  getPredictedViewheight,
  initializeLocalSpawnPrediction,
  promoteLocalPredictedState
} from "./local-loop.js";
export {
  clearLocalMovementState,
  resetLocalButtonState,
  setLocalButtonHeld,
  syncLocalMovementButtons
} from "./local-input.js";
export {
  initializeLocalClientSession,
  stepLocalClientSession
} from "./local-session.js";
export {
  advanceLocalGameplayRuntime,
  createLocalViewMotionState,
  initializeLocalSkyState,
  syncLocalGameplayFrame,
  toLocalClientHudBootstrap,
  updateLocalGameplayPlayer
} from "./local-gameplay-sync.js";
export {
  buildBrushModelSnapshots,
  buildInterpolatedBrushModelSnapshots,
  cloneBrushModelSnapshots,
  createBrushModelInterpolationState
} from "./local-brush-models.js";
export {
  CalcFov,
  CL_CalcViewValues,
  CL_PrepRefresh,
  CL_UpdateLerpFraction,
  SCR_DrawCrosshair,
  V_AddEntity,
  V_AddLight,
  V_AddLightStyle,
  V_AddParticle,
  V_ClearScene,
  V_Gun_Model_f,
  V_Gun_Next_f,
  V_Gun_Prev_f,
  V_RenderView,
  V_TestEntities,
  V_TestLights,
  V_TestParticles,
  V_Init,
  V_Viewpos_f,
  createClientViewContext,
  createClientViewDebugState,
  createClientViewScene
} from "./cl_view.js";
export {
  createClientPredictionCollisionSource
} from "./cl_pred.js";
export {
  CL_BuildPacketEntitySnapshots,
  CL_BuildFrameEntityEventEffects,
  CL_FireEntityEvents,
  CL_GetFrameEntityStates
} from "./cl_ents.js";
export {
  CL_BuildRefreshFrame,
  CL_BuildRefreshFrame as CL_AddEntities,
  CL_GetEntitySoundOrigin as CL_GetRefreshEntitySoundOrigin
} from "./refresh.js";
export {
  CL_AddTEntPacket,
  CL_AddBeams,
  CL_AddExplosions,
  CL_AddLasers,
  CL_AddPlayerBeams,
  CL_AddTEnts,
  CL_BuildTEntRefresh,
  CL_ClearTEnts,
  CL_SmokeAndFlash,
  CL_ProcessSustain,
  CL_RegisterTEntModels,
  CL_RegisterTEntSounds
} from "./cl_tent.js";
export {
  CL_BuildSkySnapshot
} from "./sky.js";
export {
  CL_BuildActionEffects,
  CL_BuildParticleEffects,
  CL_BuildEntityEventEffects,
  CL_BuildMuzzleFlash2Effects,
  CL_BuildMuzzleFlashEffects,
  CL_BuildTempEntityEffects,
  CL_ExecuteTempEntityEffects,
  CL_AddDLights,
  CL_AddLightStyles,
  CL_AddParticles,
  CL_AllocDlight,
  CL_BlasterParticles,
  CL_BlasterTrail,
  CL_BlueBlasterParticles,
  CL_BubbleTrail,
  CL_BFGExplosionParticles,
  CL_ClearEffects,
  CL_ClearParticles,
  CL_ExplosionParticles,
  CL_FlagTrail,
  CL_IonripperTrail,
  CL_LogoutEffect,
  CL_ParticleEffect,
  CL_ParticleEffect2,
  CL_ParticleEffect3,
  CL_QuadTrail,
  CL_RunDLights,
  CL_RunLightStyles,
  CL_SetLightstyle,
  CL_RailTrail,
  CL_TeleporterParticles,
  CL_TeleportParticles,
  CL_BigTeleportParticles,
  CL_BfgParticles,
  CL_BuildEntityEventEffects as CL_EntityEvent,
  CL_DiminishingTrail,
  CL_FlyEffect,
  CL_RocketTrail,
  CL_TrapParticles
} from "./cl_fx.js";
export {
  CL_Flashlight,
  CL_FlameEffects,
  CL_ForceWall,
  CL_GenericParticleEffect,
  CL_BlasterParticles2,
  CL_BlasterTrail2,
  CL_BubbleTrail2,
  CL_ColorExplosionParticles,
  CL_ColorFlash,
  CL_DebugTrail,
  CL_Heatbeam,
  CL_Nukeblast,
  CL_MonsterPlasma_Shell,
  CL_ParticleSmokeEffect,
  CL_ParticleSteamEffect,
  CL_ParticleSteamEffect2,
  CL_SmokeTrail,
  CL_TagTrail,
  CL_Tracker_Explode,
  CL_Tracker_Shell,
  CL_TrackerTrail,
  CL_Widowbeamout,
  CL_WidowSplash
} from "./cl_newfx.js";

export { svc_strings } from "../../qcommon/src/index.js";

export {
  CMD_BACKUP,
  MAX_BEAMS,
  MAX_EXPLOSIONS,
  MAX_LASERS,
  MAX_SUSTAINS,
  MAX_DLIGHTS,
  MAX_PARTICLES,
  MAX_CLIENTWEAPONMODELS,
  MAX_PARSE_ENTITIES,
  INSTANT_PARTICLE,
  connstate_t,
  dltype_t,
  createClientBeam,
  createCentity,
  createClientExplosion,
  createClientPrecacheState,
  createClientForceWall,
  createClientCinematicState,
  createClientinfo,
  createClientSkyState,
  createKbutton,
  createClientLaser,
  createClientTempLight,
  createCparticle,
  createClientRuntime,
  createClientSustain,
  createClientState,
  createClientStatic,
  createClientTentState,
  createFrame
} from "./client.js";

export type {
  ClientConsoleContext,
  ClientConsoleContextOptions,
  ClientConsoleHooks,
  ConsoleDrawConsoleSnapshot,
  ConsoleDrawCharacterCommand,
  ConsoleDumpResult,
  ConsoleNotifySnapshot,
  ConsoleLineSnapshot,
  ConsoleStretchPicCommand,
  ConsoleTextCommand,
  console_t,
} from "./console.js";
export type {
  client_key_state_t,
  ClientKeyContext,
  ClientKeyContextOptions,
  ClientKeyHooks,
  KeyBindingWriter,
  keyname_t
} from "./keys.js";
export type {
  ClientMenuContext,
  ClientMenuHooks,
  ClientMenuMapEntry,
  ClientMenuSaveSlot,
  ClientMenuState,
  PlayerConfigPreview,
  PlayerModelInfo
} from "./menu.js";
export type {
  ClientQMenuContext,
  ClientQMenuHooks,
  ClientQMenuState,
  MenuDrawCharCommand,
  MenuDrawFillCommand,
  MenuDrawStringCommand,
  MenuItem,
  menuaction_s,
  menucommon_s,
  menufield_s,
  menuframework_s,
  menulist_s,
  menuseparator_s,
  menuslider_s
} from "./qmenu.js";
export type {
  dlight_t,
  entity_t,
  GetRefAPI_t,
  image_s,
  lightstyle_t,
  model_s,
  particle_t,
  refdef_t,
  refexport_t,
  refimport_t,
  RefPictureSize,
  VidModeInfo
} from "./ref.js";
export type {
  ClientVidContext,
  ClientVidHooks,
  viddef_t,
  vrect_t
} from "./vid.js";
export type {
  ClientSoundPublicContext,
  ClientSoundPublicHooks
} from "./sound.js";
export type {
  ClientSndMemHooks
} from "./snd_mem.js";
export type {
  ClientSndDmaContext,
  ClientSndDmaHooks,
  ClientSndDmaState
} from "./snd_dma.js";
export type {
  ClientSoundMixState
} from "./snd_mix.js";
export type {
  channel_t,
  ClientSoundLocalContext,
  ClientSoundLocalHooks,
  ClientSoundLocalState,
  dma_t,
  playsound_t,
  portable_samplepair_t,
  sfx_t,
  sfxcache_t,
  wavinfo_t
} from "./snd_loc.js";
export type {
  client_screen_state_t
} from "./screen.js";
export type {
  ClientRuntime,
  client_beam_t,
  client_cinematic_t,
  client_explosion_t,
  client_force_wall_t,
  client_precache_state_t,
  client_sky_t,
  client_state_t,
  client_static_t,
  clientinfo_t,
  client_laser_t,
  client_temp_light_t,
  client_sustain_t,
  client_tent_state_t,
  centity_t,
  frame_t,
  kbutton_t
} from "./client.js";

export type { ClientEntityEvent, ClientInterpolatedEntity } from "./cl_ents.js";
export type { ClientActionEffect } from "./cl_fx.js";
export type { ClientDynamicLight, ClientRefreshFrame, ClientRenderEntity, ClientRenderParticle } from "./refresh.js";
export type { ClientBeamRender, ClientExplosionRender, ClientForceWallRender, ClientSustainRender, ClientTEntRefresh } from "./cl_tent.js";
export type {
  ClientDownloadBlock,
  ClientMuzzleFlash2Packet,
  ClientMuzzleFlashPacket,
  ClientParticleEffectPacket,
  ClientParseHooks,
  ClientSoundPacket,
  ClientTempEntityPacket
} from "./cl_parse.js";
export type { ClientMainContext, ClientMainHooks } from "./cl_main.js";
export type { ClientDownloadHooks } from "./download.js";
export type { ClientPrecacheHooks } from "./precache.js";
export type { ClientSoundRegistrationHooks } from "./sound-registration.js";
export type {
  ClientCenterPrintState,
  ClientHudBounds,
  ClientHudDrawCommand,
  ClientHudFillCommand,
  ClientHudLayoutContext,
  ClientHudNumberCommand,
  ClientHudPictureCommand,
  ClientHudStringMeasure,
  ClientHudTextCommand,
  ClientLoadingOverlayState,
  ClientNetOverlayState,
  ClientPauseOverlayState,
  ClientScreenContext,
  ClientScreenBuildOptions,
  ClientScreenConsolePlan,
  ClientScreenFrame,
  ClientScreenHudState,
  ClientTileClearCommand
} from "./cl_scrn.js";
export type { ClientInputContext, ClientInputFrameOptions, ClientInputHooks, ClientSendCmdBridgeOptions } from "./cl_input.js";
export type { ClientInputDeviceContext, ClientInputDeviceHooks } from "./input.js";
export type { LocalClientCollisionAdapter } from "./local-loop.js";
export type {
  BrushModelInterpolationState,
  LocalViewMotionState
} from "./local-gameplay-sync.js";
export type {
  BrushModelSnapshot
} from "./local-brush-models.js";
export type {
  LocalClientSessionInputState,
  LocalClientSessionSnapshotHooks,
  LocalClientSessionState
} from "./local-session.js";
export type { ClientViewOptions, ClientViewValues } from "./cl_view.js";
export type { ClientPredictionCollisionSource, ClientPredictionOptions } from "./cl_pred.js";
export type { ClientPrepRefreshOptions, ClientPrepRefreshResult } from "./cl_view.js";
export type {
  HudBounds,
  HudDrawCommand,
  HudFillCommand,
  HudNumberCommand,
  HudPictureCommand,
  HudTextCommand,
  QuakeSkySnapshot
} from "./render-contracts.js";
export type {
  LocalClientHudBootstrapData,
  LocalClientInventoryEntry,
  LocalClientItemStringEntry
} from "./local-client-bootstrap.js";
