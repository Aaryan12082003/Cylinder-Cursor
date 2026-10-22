import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { isChannel } from '@shared/channels'

contextBridge.exposeInMainWorld('cylinderflow', {
  invoke(channel: string, payload?: unknown) {
    if (!isChannel(channel)) return Promise.reject(new Error('Blocked IPC channel'))
    return ipcRenderer.invoke(channel, payload)
  },
  on(channel: string, callback: (data: unknown) => void) {
    if (channel !== 'app-event') return () => undefined
    const listener = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
