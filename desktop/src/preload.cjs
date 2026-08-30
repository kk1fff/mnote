const { contextBridge, ipcRenderer } = require("electron");

const flavorArg = process.argv.find((arg) => arg.startsWith("--mnote-flavor="));
const fromArg = flavorArg?.slice("--mnote-flavor=".length);
const flavor = fromArg === "remote" || process.env.MNOTE_FLAVOR === "remote" ? "remote" : "full";

contextBridge.exposeInMainWorld("mnote", {
  flavor,
  ready: () => ipcRenderer.invoke("mnote:ready"),
  setServer: (host) => ipcRenderer.invoke("mnote:setServer", host),
  pickFolder: () => ipcRenderer.invoke("mnote:pickFolder"),
  setup: (opts) => ipcRenderer.invoke("mnote:setup", opts),
  getToken: () => ipcRenderer.invoke("mnote:getToken"),
  setToken: (token) => ipcRenderer.invoke("mnote:setToken", token),
});
