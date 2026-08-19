export class EventEmitter<T extends Record<string | symbol, (...args: any[]) => void>> {
	private listeners: {
		[K in keyof T]?: Array<T[K]>
	} = {}

	on<K extends keyof T>(event: K, listener: T[K]) {
		if (!this.listeners[event]) {
			this.listeners[event] = []
		}
		this.listeners[event]!.push(listener)
	}

	emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>) {
		if (this.listeners[event]) {
			for (const listener of this.listeners[event]!) {
				listener(...args)
			}
		}
	}	
}