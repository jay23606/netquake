import * as cl from './cl'
import * as r from './r'
import * as com from './com'
import * as q from './q'
import * as cvar from './cvar'

export const state = {
  lava: 0,
  water: 1,
  slime: 0,
  tele: 0
}

export const init = () => {
  cvar.registerChangedEvent('r_wateralpha', (val: number) => state.water = val)
  cvar.registerChangedEvent('r_lavaalpha', (val: number) => state.lava = val)
  cvar.registerChangedEvent('r_telealpha', (val: number) => state.tele = val)
  cvar.registerChangedEvent('r_slimealpha', (val: number) => state.slime = val)
}

export const parseWorldspawn = () => {
	var key, value, data;

	state.water = r.cvr.wateralpha.value;
	state.lava = r.cvr.lavaalpha.value;
	state.tele = r.cvr.telealpha.value;
	state.slime = r.cvr.slimealpha.value;

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
		// @ts-ignore
		if (com.state.token[0] == '}')
			break; // end of worldspawn
		// @ts-ignore
		if (com.state.token[0] == '_')
			key = com.state.token.substr(1)
		else
			key = com.state.token
		key = key.trim()

		data = com.parse(data);
		if (!data)
  		  return; // error
   		value = com.state.token

		if (key === "wateralpha")
			state.water = q.atof(value);

		if (key === "lavaalpha")
      		state.lava = q.atof(value);
    
		if (key === "telealpha")
			state.tele = q.atof(value);

		if (key === "slimealpha")
			state.slime = q.atof(value);
	}
}