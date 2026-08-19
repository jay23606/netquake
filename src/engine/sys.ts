import {ISys} from './interfaces/ISys'

var sysImpl: ISys = null

export async function init(argv: string, sys: ISys) {
	sysImpl = sys
	return await sysImpl.init(argv)
}

export const error = (text: string): void =>
{
	return sysImpl.error(text)
}
export const print = (text: string): void =>
{
	return sysImpl.print(text)
}
export const quit = (reason?: string) =>
{
	return sysImpl.quit(reason)
}
export const floatTime = (): number =>
{
	return sysImpl.floatTime()
}

export const getExternalCommand = (): string => {
	return sysImpl.getExternalCommand()
}

export const requestPak = () => {
	return sysImpl.requestPak()
}

export const nameChanged = (name: string): void => {
	sysImpl.nameChanged?.(name)
}