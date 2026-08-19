import * as con from './console'
import * as cmd from './cmd'
import * as host from './host'
import * as q from './q'
import * as sv from './sv'

export type CVar = {
  name: string,
  string: string,
  archive: boolean,
  server: boolean,
  value: number
}

export type CVars = Record<string, CVar>
const changeEvents: Record<string, ((arg: any) => void)[]> = {}
export var vars: CVar[] = []

export const registerChangedEvent = (cvar: string, fn: (arg: any) => void) => {
  if (changeEvents[cvar]) {
    changeEvents[cvar].push(fn)
  } else {
    changeEvents[cvar] = [fn]
  }
}

export const findVar = function(name: string)
{
  var i;
  for (i = 0; i < vars.length; ++i)
  {
    if (vars[i].name === name)
      return vars[i];
  }
};

const create = function (name: string, value: string) {
  const found = findVar(name)
  if (found)
    return found
  else if(cmd.exists(name))
    return null
  return registerVariable(name, value)
}

export const completeVariable = function(partial: string)
{
  if (partial.length === 0)
    return;
  var i;
  for (i = 0; i < vars.length; ++i)
  {
    if (vars[i].name.substring(0, partial.length) === partial)
      return vars[i].name;
  }
};

export const set = function(name: string, value: string)
{
  var i, v, changed;
  for (i = 0; i < vars.length; ++i)
  {
    v = vars[i];
    if (v.name !== name)
      continue;
    if (v.string !== value)
      changed = true;
    v.string = value;
    v.value = q.atof(value);
    if (changed && changeEvents[name]) {
      const events = changeEvents[name]
      for(var j = 0; j < events.length; j++) {
        events[j](value)
      }
    }
    if ((v.server === true) && (changed === true) && (sv.state.server.phase === 'active'))
      host.broadcastPrint('"' + v.name + '" changed to "' + v.string + '"\n');
    return;
  }
  con.print('cvar.set: variable ' + name + ' not found\n');
};

export const setValue = function(name: string, value: any)
{
  set(name, value.toFixed(6));
};

export const setQuick = function (v: CVar, value: string) {
  var i, changed;
  if (v.string !== value)
    changed = true;
  v.string = value;
  v.value = q.atof(value);
  if (changed && changeEvents[v.name]) {
    const events = changeEvents[v.name]
    for(var j = 0; j < events.length; j++) {
      events[j](value)
    } 
  }
}

export const registerVariable = function(name: string, value: string, archive: any = undefined, server: any = undefined)
{
  var i;
  for (i = 0; i < vars.length; ++i)
  {
    if (vars[i].name === name)
    {
      con.print('Can\'t register variable ' + name + ', already defined\n');
      return;
    }
  }
  
  vars[vars.length] =
  {
    name: name,
    string: value,
    archive: archive,
    server: server,
    value: q.atof(value)
  };
  return vars[vars.length - 1];
};

export const command = function()
{
  var v = findVar(cmd.state.argv[0]);
  if (v == null)
    return;
  if (cmd.state.argv.length <= 1)
  {
    con.print('"' + v.name + '" is "' + v.string + '"\n');
    return true;
  }
  set(v.name, cmd.state.argv[1]);
  return true;
};

export const writeVariables = function()
{
  var f = [], i, v;
  for (i = 0; i < vars.length; ++i)
  {
    v = vars[i];
    if (v.archive === true)
      f[f.length] = v.name + ' "' + v.string + '"\n';
  }
  return f.join('');
};

export const set_f = () => {	
	if (cmd.state.argv.length < 3)
	{
		con.print(`${cmd.state.argv[0]} <cvar> <value>\n`)
		return;
	}
  const varname = cmd.state.argv[1];
	const varvalue = cmd.state.argv[2];
	if (cmd.state.argv.length > 3)
	{
		con.print(`${cmd.state.argv[0]} "${varname}" command with extra args\n`);
		return;
	}
  const cvar = create(varname, varvalue)
  setQuick(cvar, varvalue)
  if (cmd.state.argv[0] === 'seta') {
    cvar.archive = true
  }
}
export const init = () =>  {
  vars = []
}