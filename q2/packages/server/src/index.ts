/**
 * File: q_shared.ts
 * Purpose: Expose the Quake II server package entry points.
 *
 * This file is not a direct source port.
 * It is a package entry point for server-side modules.
 *
 * Dependencies:
 * - packages/server/src/server.ts
 */

export {
  client_state_t,
  computeServerClientEntityCapacity,
  createChallenge,
  createClientFrame,
  createServerClient,
  createServerHeaderState,
  createServerState,
  createServerStatic,
  EDICT_NUM,
  LATENCY_COUNTS,
  MAX_CHALLENGES,
  MAX_MASTERS,
  MAX_PACKET_ENTITIES,
  RATE_MESSAGES,
  redirect_t,
  server_state_t,
  SV_OUTPUTBUF_LENGTH,
  NUM_FOR_EDICT
} from "./server.js";

export {
  configureServerHost,
  configureServerHostFromFacade,
  resetServerHost,
  SV_Frame,
  SV_Init,
  SV_Shutdown
} from "./host.js";
export { createServerRuntimeFacade } from "./runtime.js";
export { createServerEntityProcedures } from "./sv_ents.js";
export { createServerGameProcedures } from "./sv_game.js";
export { createServerInitProcedures } from "./sv_init.js";
export { createServerMainProcedures } from "./sv_main.js";
export { createServerConsoleProcedures } from "./sv_ccmds.js";
export { createServerSendProcedures } from "./sv_send.js";
export { createServerUserProcedures } from "./sv_user.js";
export { createServerWorldProcedures } from "./sv_world.js";

export type {
  challenge_t,
  client_frame_t,
  client_t,
  cmodel_s,
  ServerConsoleProcedures,
  ServerEntityProcedures,
  ServerGameProcedures,
  ServerHeaderState,
  ServerInitProcedures,
  ServerMainProcedures,
  server_static_t,
  server_t,
  ServerPhysicsProcedures,
  ServerSendProcedures,
  ServerUserProcedures,
  ServerWorldProcedures
} from "./server.js";

export type { ServerWorldContext } from "./sv_world.js";
export type { ServerEntityContext } from "./sv_ents.js";
export type { ServerGameContext } from "./sv_game.js";
export type { ServerInitContext } from "./sv_init.js";
export type { ServerMainContext } from "./sv_main.js";
export type { ServerConsoleContext } from "./sv_ccmds.js";
export type { ServerSendContext } from "./sv_send.js";
export type { ServerUserContext } from "./sv_user.js";
export type { ServerHostBindings } from "./host.js";
export type { ServerRuntimeFacade, ServerRuntimeFacadeContext } from "./runtime.js";
