const configBindRx = (key: string) => `^([ \t]*bind[ \t]+"?${key}"?[ \t]+"?(.+?)"?)$`
const configValueRx = (name: string) => `^([ \t]*${name}[ \t]+"?(.*?)"?)$`

export const getValueInConfig = (cfg: string, name: string) => {
  const regex = new RegExp(configValueRx(name), 'gim')
  let match, m
  while ((m = regex.exec(cfg)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === regex.lastIndex) {
      regex.lastIndex++;
    }
    match = m
  }

  return match ? {
    name: name, 
    value: match[2],
    index: match.index,
    length: match[0].length
  } : null
}

export const getBindInConfig = (cfg: string, name: string) => {
  const regex = new RegExp(configBindRx(name), 'gim')
  let match, m
  while ((m = regex.exec(cfg)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === regex.lastIndex) {
      regex.lastIndex++;
    }
    match = m
  }

  return match ? {
    name: name, 
    value: match[2],
    index: match.index,
    length: match[0].length
  } : null
}