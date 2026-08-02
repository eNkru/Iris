import { getUserSettings } from "./procedures/get";
import { updateUserSettings } from "./procedures/update";

export const settingsRouter = {
  get: getUserSettings,
  update: updateUserSettings,
};
