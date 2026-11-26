/**
 * Bridge to the Electron main process (the Windows app). In a normal browser these
 * features are unavailable and the functions report that.
 */
type IpcRenderer = { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };

const ipc = (): IpcRenderer | null => {
    const req = (window as unknown as { require?: (name: string) => { ipcRenderer?: IpcRenderer } }).require;
    try {
        return req?.("electron")?.ipcRenderer ?? null;
    } catch {
        return null;
    }
};

export const isDesktopApp = (): boolean => ipc() !== null;

export const getAutoStart = async (): Promise<boolean> =>
    Boolean(await ipc()?.invoke("autostart:get"));

export const setAutoStart = async (enabled: boolean): Promise<boolean> =>
    Boolean(await ipc()?.invoke("autostart:set", enabled));
