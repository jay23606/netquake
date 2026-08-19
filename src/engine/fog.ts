import * as com from './com'
import * as cl from './cl'
import * as msg from './msg'
import * as con from './console'
import * as q from './q'
import * as cmd from './cmd'

const DEFAULT_DENSITY = 0.0
const DEFAULT_GRAY = 0.3

const clamp = (min: number, v: number, max: number) => {
  return v < min ? min : v > max ? max : v;
}

export const state = {
  density: DEFAULT_DENSITY,
  color: {
    red: DEFAULT_GRAY,
    green: DEFAULT_GRAY,
    blue: DEFAULT_GRAY
  },
  transition: {
    density: 0,
    color: {
      red: 0,
      green: 0,
      blue: 0
    }
  },
  fade_time: 0,
  fade_done: 0
}

const update = (density: number, red: number, green: number, blue: number, time: number) => {
	//save previous settings for fade
	if (time > 0)
	{
		//check for a fade in progress
		if (state.fade_done > cl.clState.time)
		{
		  var	f = clamp(0.0, (state.fade_done - cl.clState.time) / state.fade_time, 1.0);
			state.transition.density = f * state.transition.density + (1.0 - f) * state.density;
			state.transition.color.red = f * state.transition.color.red + (1.0 - f) * state.color.red;
			state.transition.color.green = f * state.transition.color.green + (1.0 - f) * state.color.green;
			state.transition.color.blue = f * state.transition.color.blue + (1.0 - f) * state.color.blue;
		}
		else
		{
			state.transition.density = state.density;
			state.transition.color.red = state.color.red;
			state.transition.color.green = state.color.green;
			state.transition.color.blue = state.color.blue;
		}
	}

	state.density = density;
	state.color.red = red;
	state.color.green = green;
	state.color.blue = blue;
	state.fade_time = time;
	state.fade_done = cl.clState.time + time;
}

export const fogCommand_f = () => {
	switch (cmd.state.argv.length)
	{
	default:
	case 1:
		con.print("usage:\n");
		con.print("   fog <density>\n");
		con.print("   fog <red> <green> <blue>\n");
		con.print("   fog <density> <red> <green> <blue>\n");
		con.print("current values:\n");
		con.print(`   "density" is "${state.density}\"\n`);
		con.print(`   "red" is "${state.color.red}"\n`);
		con.print(`   "green" is "${state.color.green}\n`);
		con.print(`   "blue" is "${state.color.blue}\n`);
		break;
	case 2:
		update(Math.max(0.0, q.atof(cmd.state.argv[1])),
				   state.color.red,
				   state.color.green,
				   state.color.blue,
				   0.0);
		break;
	case 3: //TEST
  update(Math.max(0.0, q.atof(cmd.state.argv[1])),
         state.color.red,
         state.color.green,
         state.color.blue,
         q.atof(cmd.state.argv[2]));
		break;
	case 4:
		update(state.density,
        clamp(0.0, q.atof(cmd.state.argv[1]), 1.0),
        clamp(0.0, q.atof(cmd.state.argv[2]), 1.0),
        clamp(0.0, q.atof(cmd.state.argv[3]), 1.0),
        0.0);
		break;
	case 5:
		update(Math.max(0.0, q.atof(cmd.state.argv[1])),
        clamp(0.0, q.atof(cmd.state.argv[2]), 1.0),
        clamp(0.0, q.atof(cmd.state.argv[3]), 1.0),
        clamp(0.0, q.atof(cmd.state.argv[4]), 1.0),
        0.0);
		break;
	case 6:
		update(Math.max(0.0, q.atof(cmd.state.argv[1])),
        clamp(0.0, q.atof(cmd.state.argv[2]), 1.0),
        clamp(0.0, q.atof(cmd.state.argv[3]), 1.0),
        clamp(0.0, q.atof(cmd.state.argv[4]), 1.0),
        q.atof(cmd.state.argv[5]));
		break;
	}
}


/*
=============
Fog_ParseServerMessage

handle an SVC_FOG message from server
=============
*/
export const parseServerMessage = () => { 
	var density = msg.readByte() / 255.0;
	var red = msg.readByte() / 255.0;
	var green = msg.readByte() / 255.0;
	var blue = msg.readByte() / 255.0;
	var time = Math.max(0.0, msg.readShort() / 100.0);

	update (density, red, green, blue, time);
}


/*
=============
Fog_ParseWorldspawn

called at map load
=============
*/
export const parseWorldspawn = () => {
  state.density = DEFAULT_DENSITY
  state.color.red = DEFAULT_GRAY
  state.color.green = DEFAULT_GRAY
  state.color.blue = DEFAULT_GRAY
  // a fade in progress must not survive the map change: cl.time restarts, so a
  // stale fade_done keeps fade math running with f >> 1 (Ironwail gl_fog.c:201-207)
  state.transition.density = DEFAULT_DENSITY
  state.transition.color.red = DEFAULT_GRAY
  state.transition.color.green = DEFAULT_GRAY
  state.transition.color.blue = DEFAULT_GRAY
  state.fade_time = 0
  state.fade_done = 0

	var key, value, data;

	data = com.parse(cl.clState.worldmodel.entities);
	if (!data)
		return; // error
	if (com.state.token[0] != '{')
		return; // error
	while (1)
	{
		data = com.parse(data);
		if (!data)
			return; // error 
		// @ts-ignore - side effects mean this happens.
		if (com.state.token[0] == '}')
			break; // end of worldspawn
		// QSS-M gl_fog.c:221-224 strips a leading '_' so "_fog" is honoured as "fog".
		// @ts-ignore - side effects mean this happens.
		if (com.state.token[0] == '_')
			key = com.state.token.substr(1)
		else
			key = com.state.token

		key = key.trim()

		data = com.parse(data);
		if (!data)
      return; // error
    
    value = com.state.token

		if (key === 'fog') {
			const split = value.split(' ')
			if (split.length === 4) {
				state.density = q.atof(split[0])
				state.color.red = q.atof(split[1])
				state.color.green = q.atof(split[2])
				state.color.blue = q.atof(split[3])
			} else {
				con.print(`Map has invalid fog value ${value}\n`)
			}
		}
	}
}


/*
=============
Fog_GetColor

calculates fog color for this frame, taking into account fade times
=============
*/
export const getColor = () => {
  var c = []
	if (state.fade_done > cl.clState.time)
	{
	  var	f = clamp(0.0, (state.fade_done - cl.clState.time) / state.fade_time, 1.0);
		c[0] = f * state.transition.color.red + (1.0 - f) * state.color.red;
		c[1] = f * state.transition.color.green + (1.0 - f) * state.color.green;
		c[2] = f * state.transition.color.blue + (1.0 - f) * state.color.blue;
		c[3] = 1.0;
	}
	else
	{
		c[0] = state.color.red;
		c[1] = state.color.green;
		c[2] = state.color.blue;
		c[3] = 1.0;
	}

	// find closest 24-bit RGB value, so solid-colored sky can match the fog perfectly
	for (var i = 0; i < 3; i++)
		c[i] = (Math.ceil(c[i] * 255)) / 255;

	return c;
}

/*
=============
Fog_GetDensity

returns current density of fog
=============
*/
export const getDensity = () =>
{
	if (state.fade_done > cl.clState.time)
	{
		var f = clamp(0.0, (state.fade_done - cl.clState.time) / state.fade_time, 1.0);
		return f * state.transition.density + (1.0 - f) * state.density;
	}
	else
		return state.density;
}

export const init = () => {
  cmd.addCommand('fog', fogCommand_f)
}