import * as cl from './cl'
import * as sv from './sv'
import * as r from './r'
import * as vec from './vec'
import * as cvar from './cvar'

export const cvr: cvar.CVars = {

}

export const state = {
  // persistent camera trace; built on first update (chase<->sv import cycle forbids
  // sv.emptyTrace at module scope) and reset via sv.resetTrace before each use
  trace: null as sv.Trace | null
}

export const init = function()
{
  cvr.back = cvar.registerVariable('chase_back', '100');
  cvr.up = cvar.registerVariable('chase_up', '16');
  cvr.right = cvar.registerVariable('chase_right', '0');
  cvr.active = cvar.registerVariable('chase_active', '0');
};

export const update = function()
{
  var forward = vec.scratch(), right = vec.scratch();
  vec.angleVectors(cl.clState.viewangles, forward, right);
  if (state.trace == null)
    state.trace = sv.emptyTrace();
  var trace = state.trace, org = r.state.refdef.vieworg;
  // vec.origin end seed keeps the vanilla memset-zero endpos on a no-hit trace
  sv.resetTrace(trace, vec.origin);
  var end = vec.scratch();
  end[0] = org[0] + 4096.0 * forward[0];
  end[1] = org[1] + 4096.0 * forward[1];
  end[2] = org[2] + 4096.0 * forward[2];
  sv.recursiveHullCheck(cl.clState.worldmodel.hulls[0], 0, 0.0, 1.0, org, end, trace);
  var stop = trace.endpos;
  stop[2] -= org[2];
  var dist = (stop[0] - org[0]) * forward[0] + (stop[1] - org[1]) * forward[1] + stop[2] * forward[2];
  if (dist < 1.0)
    dist = 1.0;
  r.state.refdef.viewangles[0] = Math.atan(stop[2] / dist) / Math.PI * -180.0;
  org[0] -= forward[0] * cvr.back.value + right[0] * cvr.right.value;
  org[1] -= forward[1] * cvr.back.value + right[1] * cvr.right.value;
  org[2] += cvr.up.value;
};