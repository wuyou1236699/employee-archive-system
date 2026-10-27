import cloudbase from "@cloudbase/js-sdk";
import { cloudConnectionEnabled } from "./showcaseMode";

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID?.trim();
const publishableKey = import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY?.trim();
const region = import.meta.env.VITE_CLOUDBASE_REGION?.trim() || "ap-shanghai";

export const cloudbaseConfig = cloudConnectionEnabled && envId && publishableKey
  ? {
      env: envId,
      region,
      accessKey: publishableKey,
    }
  : null;

export const app = cloudbaseConfig ? cloudbase.init(cloudbaseConfig) : null;
export const auth = app?.auth ?? null;
