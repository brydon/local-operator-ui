import { contextBridge, ipcRenderer } from "electron";
import type { CompanionAppearance } from "../shared/companion-skin";
import type {
	CompanionBridge,
	CompanionState,
} from "../shared/desktop-companion";

const companion: CompanionBridge = {
	getAppearance: () => ipcRenderer.invoke("companion:get-appearance"),
	onAppearance: (listener) => {
		const receive = (
			_event: Electron.IpcRendererEvent,
			appearance: CompanionAppearance,
		) => listener(appearance);
		ipcRenderer.on("companion:appearance", receive);
		return () => ipcRenderer.removeListener("companion:appearance", receive);
	},
	getState: () => ipcRenderer.invoke("companion:get-state"),
	onState: (listener) => {
		const receive = (
			_event: Electron.IpcRendererEvent,
			state: CompanionState,
		) => listener(state);
		ipcRenderer.on("companion:state", receive);
		return () => ipcRenderer.removeListener("companion:state", receive);
	},
	openChat: () => ipcRenderer.send("companion:action", "open"),
	hide: () => ipcRenderer.send("companion:action", "hide"),
	setInteractive: (value) =>
		ipcRenderer.send("companion:action", "interactive", value),
	drag: (phase) => ipcRenderer.send("companion:action", "drag", phase),
	nudge: (direction) =>
		ipcRenderer.send("companion:action", "nudge", direction),
};

contextBridge.exposeInMainWorld("companion", companion);
