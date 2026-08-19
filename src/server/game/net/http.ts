import * as http from 'http'
import * as host from '../../../engine/host'
import * as pr from '../../../engine/pr'
import * as net from '../../../engine/net'
import * as sv from '../../../engine/sv'
import * as sys from '../sys'
import * as url from 'url'
import * as cvar from '../../../engine/cvar'

const htmlSpecialChars = function (str: string) {
  var out = [], i, c;
  for (i = 0; i < str.length; ++i) {
    c = str.charCodeAt(i);
    switch (c) {
      case 38: out[out.length] = '&amp;'; continue;
      case 60: out[out.length] = '&lt;'; continue;
      case 62: out[out.length] = '&gt;'; continue;
    }
    out[out.length] = String.fromCharCode(c);
  }
  return out.join('');
};

const getCvars = () => {
  return cvar.vars
    .filter(v => v.server === true)
    .map(v => ({ rule: v.name, value: v.string }))
}

const getActivePlayers = () => {
  const time = sys.floatTime()
  const players = []

  for (let i = 0; i < sv.state.svs.maxclients; ++i) {
    const client = sv.state.svs.clients[i];
    if (client.active !== true)
      continue;
    const seconds = time - client.netconnection.connecttime
    players.push({
      name: htmlSpecialChars(sv.getClientName(client)),
      colors: client.colors,
      frags: client.edict.v_float[pr.entvars.frags].toFixed(0),
      connectedTime: seconds,
    })
  }
  return players
}
const createQueryResponse = () => {
  return {
    hostname: htmlSpecialChars(net.cvr.hostname.string),
    maxPlayers: sv.state.svs.maxclients.toString(),
    players: getActivePlayers(),
    map: pr.getString(pr.state.globals_int[pr.globalvars.mapname]),
    serverSettings: JSON.stringify(getCvars()),
    version: 3
  }
}

const sendOptions = (_request: http.IncomingMessage, response: http.ServerResponse) => {
  response.statusCode = 200;
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization');
  response.end();
}

const onRequest = (request: http.IncomingMessage, response: http.ServerResponse) => {
  if (request.method === 'OPTIONS') {
    return sendOptions(request, response)
  }
  const pathname = url.parse(request.url).pathname;
  const pathParams = pathname.split('/');
  const lastParam = pathParams[pathParams.length - 1];

  // Ping responds regardless of server state (health check)
  if (lastParam === 'ping') {
    if (request.method === 'GET' || request.method === 'HEAD') {
      response.statusCode = 200;
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization');
      response.setHeader('Content-Type', 'application/json; charset=UTF-8');
      if (request.method !== 'HEAD') {
        response.write(JSON.stringify({ message: 'pong' }))
      }
      response.end();
      return
    } else {
      response.statusCode = 405;
      response.write("Method not allowed")
      response.end();
    }
  }

  if (sv.state.server.phase !== 'active') {
    response.statusCode = 503;
    response.end();
    return;
  }

  if (lastParam === 'status') {
    if (request.method === 'GET' || request.method === 'HEAD') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=UTF-8');
      if (request.method !== 'HEAD') {
        response.write(JSON.stringify(createQueryResponse()))
      }
      response.end();
      return
    } else {
      response.statusCode = 405;
      response.write("Method not allowed")
      response.end();
    }
  } else if (lastParam === 'mastervalidate') {
    if (request.method === 'POST') {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json; charset=UTF-8');
      request.on('data', (data) => {
        const str = data.toString('ascii')
        const obj = JSON.parse(str)
        if (obj.id === host.state.serverId) {
          response.statusCode = 200;
          response.write(JSON.stringify({ message: "OK" }))
        } else {
          response.write(JSON.stringify({ message: "Invalid ID" }))
        }
      })
      request.on('end', () => {
        response.end();
      })
      return
    } else {
      response.statusCode = 405;
      response.write("Method not allowed")
      response.end();
    }
  } else if (lastParam === 'rcon') {
    var data;
    try {
      data = decodeURIComponent(pathParams.slice(2).join('/')).split('\n')[0];
    }
    catch (e) {
      response.statusCode = 400;
      response.end();
      return;
    }
    if (data.length === 0) {
      response.statusCode = 400;
      response.end();
      return;
    }
    if (request.headers.authorization == null) {
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', 'Basic realm="Quake"');
      response.end();
      return;
    }
    var password = request.headers.authorization;
    if (password.substring(0, 6) !== 'Basic ') {
      response.statusCode = 403;
      response.end();
      return;
    }
    try {
      password = (Buffer.from(password.substring(6), 'base64')).toString('ascii');
    }
    catch (e) {
      response.statusCode = 403;
      response.end();
      return;
    }
    if (password.substring(0, 6) !== 'quake:') {
      response.statusCode = 403;
      response.end();
      return;
    }
    response.statusCode = (host.remoteCommand(request.connection.remoteAddress, data, password.substring(6)) === true) ? 200 : 403;
    response.end();
    return;
  };
  response.statusCode = 404;
  response.end();
};


export const createHttpServer = (port: number) => {
  const server = http.createServer();
  server.listen(port);
  server.on('request', onRequest);

  return server
}

