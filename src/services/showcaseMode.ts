// Public showcase is offline unless the operator explicitly opts into their own cloud.
export const cloudConnectionEnabled = import.meta.env.VITE_ENABLE_CLOUDBASE === "true";
export const localShowcaseEnabled = !cloudConnectionEnabled;
